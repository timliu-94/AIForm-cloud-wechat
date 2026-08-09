from __future__ import annotations

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from hashlib import sha256
from pathlib import Path

from .fields import sort_acroforms_reading_order
from .ocr import leaf_cache_key
from .traversal import iter_page_leaf_nodes

LLM_BASE_URL = "https://api.deepseek.com"
LLM_MODEL = "deepseek-v4-flash"
LLM_INFER_DIR = Path("llm_outputs")
LLM_TEMPERATURE = 0
LLM_MAX_TOKENS = 4000
LLM_MAX_WORKERS = 10
LLM_MAX_RETRIES = 4
LLM_RETRY_BASE_DELAY = 1.0

ALLOWED_INPUT_TYPES = {
    "普通文本",
    "日期",
    "国家或地区",
    "电话",
    "金额",
    "地址",
    "护照号码",
    "单选",
    "多选",
    "单选+文本",
    "多选+文本",
    "待确认",
}

LLM_SYSTEM_PROMPT = """你是一个 PDF 表单字段识别助手。请根据输入的 PDF 原生文字块，识别其中需要用户填写或选择的内容。一个文字块中可能包含普通填写字段，也可能包含多个选项。

仅输出合法的 JSON 对象，不要输出解释、Markdown、代码块或任何其他内容。

固定输出格式：

{"field_name":[],"input_type":[]}

字段说明：

field_name：列表。每个元素表示一个需要填写的字段名称或一个可供选择的选项。
input_type：列表。每个元素表示对应 field_name 的输入类型。
field_name 和 input_type 的元素数量必须完全一致，并按照数组下标一一对应。

严格要求：
1. field_name 和 input_type 必须按字段或选项在原文中出现的顺序排列，后续会按相同顺序赋值给表单控件。
2. 对单选或多选区域，每一个具体选项都必须单独返回，例如“男”“女”“普通护照”；不要只返回分组名“性别”“护照类型”。
3. 对文本填写区域返回简洁的字段名。属于同一个填写区域的相邻说明文字应合并为一个字段，不要拆分。
4. 同一组只能选择一个选项时标记为“单选”，允许同时选择多个时标记为“多选”；不要仅根据方框符号判断。
5. 包含“其他”“请注明”“Specify”等需要额外填写文字的选项，应标记为“单选+文本”或“多选+文本”。
6. 多语言字段名归一化规则：
   - 当中文、英文、意大利文等多个语种是在解释同一个字段或同一个选项时，它们只能对应一个 field_name，禁止按语种拆成多个元素。
   - 只要原文包含能表达该字段或选项含义的中文，field_name 就必须选择简洁中文；不得选择外文，也不得输出“中文/English/Italiano”之类的多语拼接名称。
   - 只有原文完全没有可用中文时，才使用原文中的外文名称。
   - 示例：“Cognome / Surname / 姓”只输出“姓”；“Data di nascita / Date of birth / 出生日期”只输出“出生日期”；“Maschio / Male / 男，Femmina / Female / 女”按顺序输出“男”“女”。
7. 忽略标题、说明文字、页码、字段编号和纯装饰内容，不要推测原文中没有出现的字段或选项。
8. 无法确定具体语义或类型时，将对应元素标记为“待确认”。没有识别到字段时输出空列表。
9. 文字块会出现类目，选项的情况，不要把类目设置成选项的第一位。例如：
    "8. Sesso/ Sex / 性别:
        □ Maschile/ Male /男
        □ Femminile / Female /女
        □ Altro / Other / 其他
    "
    解析结果应该是：
        leaf_text：Sesso/ Sex / 性别
        选项一：男
        选项二：女
        选项三：其他

input_type 只能使用以下值："普通文本"、"日期"、"国家或地区"、"电话"、"金额"、"地址"、"护照号码"、"单选"、"多选"、"单选+文本"、"多选+文本"、"待确认"。
"""


class LLMResponseError(RuntimeError):
    def __init__(self, errors, raw_contents, response_metadata, attempt_count):
        self.errors = list(errors)
        self.raw_contents = list(raw_contents)
        self.response_metadata = list(response_metadata)
        self.attempt_count = attempt_count
        super().__init__(self.errors[-1] if self.errors else "LLM response validation failed")


class LLMBatchInferenceError(RuntimeError):
    def __init__(self, summary, failed_leaves, infer_dir=LLM_INFER_DIR):
        self.summary = summary
        self.failed_leaves = failed_leaves
        examples = ", ".join(
            f"page={item['page']} leaf={item['leaf_index']} error={item['error']}"
            for item in failed_leaves[:3]
        )
        super().__init__(
            f"LLM inference failed for {summary['remote_failed']} leaf/leaves after retries. "
            f"Diagnostics were saved under {infer_dir}. {examples}"
        )


def make_llm_client(api_key=None, base_url=LLM_BASE_URL):
    from openai import OpenAI

    api_key = api_key or os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("缺少 DEEPSEEK_API_KEY 环境变量，无法调用 LLM API。")
    return OpenAI(api_key=api_key, base_url=base_url)


def parse_llm_json(content):
    text = (content or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError(f"LLM 返回 JSON 不是对象: {type(data).__name__}")
    return data


def make_acroform_specs(leaf, page_height):
    ordered = sort_acroforms_reading_order(leaf.get("acroforms") or [], page_height)
    return [
        {
            "index": index,
            "acroform_name": form.get("name"),
            "field_type": form.get("field_type"),
            "rect": form.get("rect"),
            "manual": bool(form.get("manual")),
        }
        for index, form in enumerate(ordered)
    ]


def make_llm_user_content(text, acroform_specs=None):
    specs = list(acroform_specs or [])
    if not specs:
        return text
    return (
        "PDF 原生文字块：\n"
        f"{text}\n\n"
        f"本区域按阅读顺序共有 {len(specs)} 个 AcroForm：\n"
        f"{json.dumps(specs, ensure_ascii=False)}\n\n"
        f"必须按 AcroForm 的 index 一一对应返回，最多返回 {len(specs)} 组 "
        "field_name/input_type。不要把问题标题、分组标题或说明文字单独作为字段；"
        "按钮字段应返回该按钮对应的具体选项名称。"
    )


def validate_llm_fields(parsed, max_fields=None):
    field_names = parsed.get("field_name")
    input_types = parsed.get("input_type")
    if not isinstance(field_names, list):
        raise ValueError("LLM JSON 缺少 field_name 数组")
    if not isinstance(input_types, list):
        raise ValueError("LLM JSON 缺少 input_type 数组")
    if len(field_names) != len(input_types):
        raise ValueError(
            "LLM field_name/input_type 数量不一致: "
            f"field_name={len(field_names)} input_type={len(input_types)}"
        )
    if max_fields is not None and len(field_names) > max_fields:
        raise ValueError(
            "LLM 返回字段数量超过 AcroForm 数量: "
            f"fields={len(field_names)} acroforms={max_fields}"
        )

    normalized_names = []
    normalized_types = []
    for index, (field_name, input_type) in enumerate(zip(field_names, input_types)):
        if not isinstance(field_name, str) or not field_name.strip():
            raise ValueError(f"field_name[{index}] 为空")
        if input_type not in ALLOWED_INPUT_TYPES:
            raise ValueError(f"input_type[{index}] 不合法: {input_type!r}")
        normalized_names.append(field_name.strip())
        normalized_types.append(input_type)

    return normalized_names, normalized_types


def infer_leaf_text_fields(
    text,
    client,
    acroform_specs=None,
    model=LLM_MODEL,
    temperature=LLM_TEMPERATURE,
    max_tokens=LLM_MAX_TOKENS,
    max_retries=LLM_MAX_RETRIES,
    retry_base_delay=LLM_RETRY_BASE_DELAY,
):
    user_content = make_llm_user_content(text, acroform_specs)
    errors = []
    raw_contents = []
    response_metadata = []

    for attempt in range(max_retries + 1):
        messages = [
            {"role": "system", "content": LLM_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]
        if raw_contents:
            messages.extend(
                [
                    {"role": "assistant", "content": raw_contents[-1]},
                    {
                        "role": "user",
                        "content": f"上一次输出无效：{errors[-1]}。请严格按要求重新输出完整 JSON。",
                    },
                ]
            )
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
                extra_body={"thinking": {"type": "disabled"}},
            )
            choice = response.choices[0]
            message = choice.message
            content = message.content or ""
            reasoning_content = getattr(message, "reasoning_content", None) or ""
            usage = getattr(response, "usage", None)
            metadata = {
                "finish_reason": getattr(choice, "finish_reason", None),
                "reasoning_content_length": len(reasoning_content),
                "prompt_tokens": getattr(usage, "prompt_tokens", None),
                "completion_tokens": getattr(usage, "completion_tokens", None),
            }
            raw_contents.append(content)
            response_metadata.append(metadata)
            if not content.strip():
                raise ValueError(
                    "LLM 返回空 content: "
                    f"finish_reason={metadata['finish_reason']!r} "
                    f"reasoning_content_length={metadata['reasoning_content_length']}"
                )
            parsed = parse_llm_json(content)
            parsed["field_name"], parsed["input_type"] = validate_llm_fields(
                parsed,
                max_fields=len(acroform_specs) if acroform_specs else None,
            )
            parsed["raw_content"] = content
            parsed["response_metadata"] = metadata
            parsed["attempt_count"] = attempt + 1
            return parsed
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
            if attempt < max_retries and retry_base_delay > 0:
                time.sleep(min(retry_base_delay * (2**attempt), 8.0))

    raise LLMResponseError(errors, raw_contents, response_metadata, max_retries + 1)


def make_cached_llm_result(result, model=LLM_MODEL):
    result = dict(result or {})
    result.setdefault("field_name", [])
    result.setdefault("input_type", [])
    result["model"] = result.get("model", model)
    result["source"] = "local_json_cache"
    return result


def llm_cache_key(page_no, leaf_index, bbox, text, acroforms=None, model=LLM_MODEL):
    acroform_signature = [
        {
            "name": form.get("acroform_name") or form.get("name"),
            "field_type": form.get("field_type"),
            "rect": form.get("rect"),
            "manual": bool(form.get("manual")),
        }
        for form in (acroforms or [])
        if isinstance(form, dict)
    ]
    inference_fingerprint = sha256(
        json.dumps(
            {
                "model": model,
                "system_prompt": LLM_SYSTEM_PROMPT,
                "text": text,
                "acroforms": acroform_signature,
            },
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()[:12]
    return f"{leaf_cache_key(page_no, leaf_index, bbox)}_{inference_fingerprint}"


def normalize_llm_pairs(llm_result):
    if not isinstance(llm_result, dict):
        return []
    field_names = llm_result.get("field_name") or []
    input_types = llm_result.get("input_type") or []
    if ("field_name" in llm_result or "input_type" in llm_result) and isinstance(field_names, list):
        type_list = input_types if isinstance(input_types, list) else []
        return [
            {
                "field_name": field_name,
                "input_type": type_list[index] if index < len(type_list) else None,
            }
            for index, field_name in enumerate(field_names)
        ]

    # Compatibility for older artifacts that already used an object list.
    fields = llm_result.get("fields") or []
    return [
        {
            "field_name": f.get("field_name"),
            "input_type": f.get("input_type"),
        }
        for f in fields
        if isinstance(f, dict)
    ]


def infer_leaf_input_type(leaf):
    if leaf.get("input_type"):
        return leaf["input_type"]
    input_types = [
        field["input_type"]
        for field in leaf.get("llm_ocr_fields", []) or []
        if isinstance(field, dict) and field.get("input_type")
    ]
    if not input_types:
        return None
    unique_types = list(dict.fromkeys(input_types))
    return unique_types[0] if len(unique_types) == 1 else unique_types


def sync_leaf_input_type_to_acroforms(leaf):
    input_type = infer_leaf_input_type(leaf)
    if input_type is not None:
        leaf["input_type"] = input_type
    return leaf


def apply_llm_result_to_leaf(leaf, llm_result, infer_path):
    llm_result["cache_file"] = str(infer_path)
    leaf["llm_ocr_fields"] = normalize_llm_pairs(llm_result)
    leaf["llm_ocr_infer"] = llm_result
    sync_leaf_input_type_to_acroforms(leaf)
    return bool(leaf["llm_ocr_fields"])


def write_successful_llm_result(infer_path, llm_result):
    infer_path.write_text(json.dumps(llm_result, ensure_ascii=False, indent=2), encoding="utf-8")
    infer_path.with_suffix(".error.json").unlink(missing_ok=True)


def infer_leaf_job(job, api_key, base_url, model):
    client = make_llm_client(api_key=api_key, base_url=base_url)
    parsed = infer_leaf_text_fields(
        job["text"],
        client,
        acroform_specs=job["acroform_specs"],
        model=model,
        retry_base_delay=job["retry_base_delay"],
    )
    llm_result = {**parsed, "model": model, "source": "remote_llm"}
    write_successful_llm_result(job["infer_path"], llm_result)
    return job, llm_result


def record_failed_llm_job(job, exc, model):
    errors = getattr(exc, "errors", [f"{type(exc).__name__}: {exc}"])
    raw_contents = getattr(exc, "raw_contents", [])
    response_metadata = getattr(exc, "response_metadata", [])
    attempt_count = getattr(exc, "attempt_count", 1)
    error_path = job["infer_path"].with_suffix(".error.json")
    failed_result = {
        "field_name": [],
        "input_type": [],
        "model": model,
        "source": "remote_llm",
        "success": False,
        "error": errors[-1],
        "errors": errors,
        "raw_contents": raw_contents,
        "response_metadata": response_metadata,
        "attempt_count": attempt_count,
        "cache_file": str(job["infer_path"]),
        "error_file": str(error_path),
    }
    error_path.write_text(json.dumps(failed_result, ensure_ascii=False, indent=2), encoding="utf-8")
    job["leaf"]["llm_ocr_fields"] = []
    job["leaf"]["llm_ocr_infer"] = failed_result
    sync_leaf_input_type_to_acroforms(job["leaf"])
    return {
        "page": job["page_no"],
        "leaf_index": job["leaf_index"],
        "error": errors[-1],
        "error_file": str(error_path),
        "attempt_count": attempt_count,
    }


def add_llm_fields_to_leaves(
    parsed_pages,
    llm_client=None,
    infer_dir=LLM_INFER_DIR,
    model=LLM_MODEL,
    overwrite=False,
    refresh_cache=False,
    max_workers=LLM_MAX_WORKERS,
    api_key=None,
    base_url=LLM_BASE_URL,
    fail_on_error=True,
    progress=False,
    retry_base_delay=LLM_RETRY_BASE_DELAY,
):
    infer_dir = Path(infer_dir)
    infer_dir.mkdir(parents=True, exist_ok=True)
    api_key = api_key or os.getenv("DEEPSEEK_API_KEY")

    total = eligible = skipped_empty_text = skipped_no_acroforms = skipped_not_needed = 0
    succeeded = cache_hits = cache_invalid = remote_succeeded = remote_failed = api_attempts = 0
    failed_leaves = []
    pending_jobs = []
    for page_info, leaf in iter_page_leaf_nodes(parsed_pages):
        total += 1
        if leaf.get("llm_ocr_infer") and not overwrite:
            sync_leaf_input_type_to_acroforms(leaf)
            continue

        page_no = page_info["page"]
        size = page_info.get("size") or [0, 0]
        page_height = size[1] if len(size) >= 2 else 0
        text = (leaf.get("text") or "").strip()
        acroform_specs = make_acroform_specs(leaf, page_height)
        infer_path = infer_dir / f"{llm_cache_key(page_no, total, leaf['bbox'], text, acroform_specs, model)}.json"

        if not acroform_specs:
            leaf["llm_ocr_fields"] = []
            leaf["llm_ocr_infer"] = {
                "field_name": [],
                "input_type": [],
                "model": model,
                "source": "no_acroforms",
                "cache_file": str(infer_path),
            }
            skipped_no_acroforms += 1
            continue

        if leaf.get("is_need_filled") is False:
            leaf["llm_ocr_fields"] = []
            leaf["llm_ocr_infer"] = {
                "field_name": [],
                "input_type": [],
                "model": model,
                "source": "not_need_filled",
                "cache_file": str(infer_path),
            }
            skipped_not_needed += 1
            continue

        if not text:
            leaf["llm_ocr_fields"] = []
            leaf["llm_ocr_infer"] = {
                "field_name": [],
                "input_type": [],
                "model": model,
                "source": "empty_text",
                "cache_file": str(infer_path),
            }
            sync_leaf_input_type_to_acroforms(leaf)
            skipped_empty_text += 1
            continue

        eligible += 1
        job = {
            "leaf_index": total,
            "page_no": page_no,
            "leaf": leaf,
            "text": text,
            "acroform_specs": acroform_specs,
            "infer_path": infer_path,
            "retry_base_delay": retry_base_delay,
        }
        if infer_path.exists() and not refresh_cache:
            try:
                llm_result = make_cached_llm_result(
                    json.loads(infer_path.read_text(encoding="utf-8")), model=model
                )
                llm_result["field_name"], llm_result["input_type"] = validate_llm_fields(
                    llm_result,
                    max_fields=len(acroform_specs),
                )
                if apply_llm_result_to_leaf(leaf, llm_result, infer_path):
                    succeeded += 1
                infer_path.with_suffix(".error.json").unlink(missing_ok=True)
                cache_hits += 1
                continue
            except Exception:
                cache_invalid += 1
        if llm_client is not None:
            try:
                llm_result = {
                    **infer_leaf_text_fields(
                        text,
                        llm_client,
                        acroform_specs=acroform_specs,
                        model=model,
                        retry_base_delay=retry_base_delay,
                    ),
                    "model": model,
                    "source": "remote_llm",
                }
                write_successful_llm_result(infer_path, llm_result)
                if apply_llm_result_to_leaf(leaf, llm_result, infer_path):
                    succeeded += 1
                remote_succeeded += 1
                api_attempts += llm_result.get("attempt_count", 1)
            except Exception as exc:
                failed = record_failed_llm_job(job, exc, model)
                failed_leaves.append(failed)
                remote_failed += 1
                api_attempts += failed["attempt_count"]
            continue
        pending_jobs.append(job)

    if progress:
        print(
            "[llm] "
            f"total_leaves={total} eligible={eligible} cache_hits={cache_hits} "
            f"queued={len(pending_jobs)} skipped_no_acroforms={skipped_no_acroforms} "
            f"skipped_not_needed={skipped_not_needed} skipped_empty_text={skipped_empty_text}",
            flush=True,
        )

    if pending_jobs:
        if not api_key:
            raise RuntimeError("缺少 DEEPSEEK_API_KEY 环境变量，无法调用 LLM API。")
        worker_count = max(1, min(int(max_workers or 1), len(pending_jobs)))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            future_map = {executor.submit(infer_leaf_job, job, api_key, base_url, model): job for job in pending_jobs}
            for future in as_completed(future_map):
                job = future_map[future]
                try:
                    done_job, llm_result = future.result()
                    if apply_llm_result_to_leaf(done_job["leaf"], llm_result, done_job["infer_path"]):
                        succeeded += 1
                    remote_succeeded += 1
                    api_attempts += llm_result.get("attempt_count", 1)
                    if progress:
                        print(
                            f"[llm] page={job['page_no']} leaf={job['leaf_index']} "
                            f"status=ok fields={len(normalize_llm_pairs(llm_result))} "
                            f"attempts={llm_result.get('attempt_count', 1)}",
                            flush=True,
                        )
                except Exception as exc:
                    failed = record_failed_llm_job(job, exc, model)
                    failed_leaves.append(failed)
                    remote_failed += 1
                    api_attempts += failed["attempt_count"]
                    if progress:
                        print(
                            f"[llm] page={job['page_no']} leaf={job['leaf_index']} "
                            f"status=failed attempts={failed['attempt_count']} error={failed['error']}",
                            flush=True,
                        )

    summary = {
        "total_leaves_processed": total,
        "eligible_leaves": eligible,
        "leaves_with_fields": succeeded,
        "skipped_empty_text": skipped_empty_text,
        "skipped_no_acroforms": skipped_no_acroforms,
        "skipped_not_needed": skipped_not_needed,
        "cache_hits": cache_hits,
        "cache_invalid": cache_invalid,
        "remote_attempted": remote_succeeded + remote_failed,
        "remote_succeeded": remote_succeeded,
        "remote_failed": remote_failed,
        "remote_calls": remote_succeeded,
        "api_attempts": api_attempts,
        "max_workers": max_workers,
    }
    if progress:
        print(f"[llm] summary={json.dumps(summary, ensure_ascii=False)}", flush=True)
    if failed_leaves and fail_on_error:
        raise LLMBatchInferenceError(summary, failed_leaves, infer_dir=infer_dir)
    return summary
