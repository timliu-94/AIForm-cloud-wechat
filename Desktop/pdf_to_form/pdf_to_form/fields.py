FIELD_EXAMPLES = {
    "姓": "表 BIAO",
    "名": "小签 XIAOQIAN",
    "出生地": "湖北 HUBEI",
    "出生国": "中国 CHINA",
    "现国籍": "CHINA",
    "出生时国籍": "CHINA",
    "其他国籍": "CHINA",
    "国籍": "CHINA",
    "公民身份证号码": "420106199001011234（身份证号）",
    "旅行证件编号": "E12345678（护照号）",
    "旅行证件或身份证编号": "E12345678（护照号）",
    "签发国": "CHINA",
    "签发机关": "公安部出入境管理局",
    "合法监护人姓名": "表小签 BIAO XIAOQIAN",
    "合法监护人国籍": "CHINA",
    "合法监护人住址": "湖北省武汉市…，HUBEI",
    "合法监护人电话号码": "+86 138 0000 0000",
    "合法监护人电子邮件": "name@example.com",
    "住址": "湖北省武汉市江汉区…，HUBEI",
    "地址": "湖北省武汉市江汉区…，HUBEI",
    "电子邮箱": "name@example.com",
    "电子邮件": "name@example.com",
    "电话号码": "+86 138 0000 0000",
    "公司电话": "+86 27 0000 0000",
    "当前职业": "工程师 ENGINEER",
    "主要申根目的地": "意大利 ITALY",
    "首入申根国": "意大利 ITALY",
    "申请入境次数": "一次入境 / 两次入境 / 多次入境",
}


def sort_acroforms_reading_order(acroforms, page_height):
    def sort_key(pair):
        idx, af = pair
        rect = af.get("rect") or [0, 0, 0, 0]
        row = round((page_height - rect[3]) / 10)
        return (row, rect[0], idx)

    auto_pairs = [(idx, af) for idx, af in enumerate(acroforms) if not af.get("manual")]
    manual_pairs = [(idx, af) for idx, af in enumerate(acroforms) if af.get("manual")]
    return [af for _, af in sorted(auto_pairs, key=sort_key)] + [af for _, af in manual_pairs]


def is_date_input_type(input_type):
    if isinstance(input_type, list):
        return any("日期" in str(x) for x in input_type)
    return "日期" in str(input_type or "")


def manual_value_or_fallback(af, key, fallback):
    if key in af and af.get(key) not in (None, ""):
        return af.get(key)
    return fallback


def field_text_transform(field_name):
    name = str(field_name or "")
    uppercase_fields = {"姓", "名", "出生时姓氏", "公民身份证号码", "旅行证件编号", "旅行证件或身份证编号"}
    if name in uppercase_fields or "证件号" in name or "证件编号" in name:
        return "uppercase"
    if "地址" in name or "住址" in name or "原因" in name or "说明" in name:
        return "lowercase"
    return ""


def field_example_for_name(field_name, overrides=None):
    if overrides and field_name in overrides:
        return overrides[field_name]
    return FIELD_EXAMPLES.get(field_name, "")


def assign_field_names_to_leaf_acroforms(leaf, page_height, field_example_overrides=None):
    acroforms = leaf.get("acroforms") or []
    if not acroforms:
        return 0

    ordered = sort_acroforms_reading_order(acroforms, page_height)
    llm_pairs = leaf.get("llm_ocr_fields") or []
    for index, af in enumerate(ordered):
        pair = llm_pairs[index] if index < len(llm_pairs) and isinstance(llm_pairs[index], dict) else {}
        if af.get("field_name_source") == "manual":
            field_name = manual_value_or_fallback(af, "field_name", af.get("name") or "待确认")
            input_type = manual_value_or_fallback(af, "input_type", pair.get("input_type"))
            field_name_source = "manual"
        elif pair.get("field_name"):
            field_name = pair["field_name"]
            input_type = pair.get("input_type") or af.get("input_type")
            field_name_source = "llm"
        else:
            field_name = af.get("field_name") or af.get("name") or "待确认"
            input_type = af.get("input_type")
            field_name_source = af.get("field_name_source") or "fallback"
        af["field_name"] = field_name
        af["field_name_source"] = field_name_source
        af["input_type"] = input_type
        af["textTransform"] = field_text_transform(field_name)
        af["field_example"] = (
            ""
            if af.get("field_type") == "/Btn" or is_date_input_type(input_type)
            else field_example_for_name(field_name, field_example_overrides)
        )
    return len(ordered)


def assign_field_names_to_pages(parsed_pages, field_example_overrides=None):
    total = 0
    for page_info in parsed_pages:
        size = page_info.get("size") or [0, 0]
        page_height = size[1] if len(size) >= 2 else 0

        leaf_nodes = page_info.get("leaf_nodes")
        if isinstance(leaf_nodes, list):
            for leaf in leaf_nodes:
                total += assign_field_names_to_leaf_acroforms(
                    leaf, page_height, field_example_overrides
                )
            sync_page_acroform_fields(page_info)
            continue

        def walk(node):
            nonlocal total
            if node.get("is_leaf"):
                total += assign_field_names_to_leaf_acroforms(
                    node, page_height, field_example_overrides
                )
                return
            for child in node.get("children", []) or []:
                walk(child)

        for root in page_info.get("trees", []) or []:
            walk(root)
    return total


def sync_page_acroform_fields(page_info):
    """Keep the page inventory aligned with final leaf-level field metadata."""
    metadata_by_key = {}
    for leaf in page_info.get("leaf_nodes", []) or []:
        for form in leaf.get("acroforms", []) or []:
            key = (form.get("name"), tuple(form.get("rect") or []))
            metadata_by_key[key] = form

    keys_to_copy = (
        "field_name",
        "field_name_source",
        "input_type",
        "textTransform",
        "field_example",
        "is_acro_need_filled",
        "is_acro_handwritting",
    )
    for page_form in page_info.get("acroforms", []) or []:
        key = (page_form.get("name"), tuple(page_form.get("rect") or []))
        leaf_form = metadata_by_key.get(key)
        if leaf_form is None:
            continue
        for field_key in keys_to_copy:
            if field_key in leaf_form:
                page_form[field_key] = leaf_form[field_key]


def find_unresolved_required_acroforms(parsed_pages):
    unresolved = []
    for page_info in parsed_pages:
        for leaf in page_info.get("leaf_nodes", []) or []:
            if leaf.get("is_need_filled") is False:
                continue
            for form in leaf.get("acroforms", []) or []:
                if form.get("is_acro_need_filled") is False:
                    continue
                if form.get("field_name_source") in {"llm", "manual"} and form.get("field_name"):
                    continue
                unresolved.append(
                    {
                        "page": page_info.get("page"),
                        "leaf_id": leaf.get("leaf_id"),
                        "acroform_name": form.get("name"),
                        "field_name": form.get("field_name"),
                        "field_name_source": form.get("field_name_source"),
                    }
                )
    return unresolved
