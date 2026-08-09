from openai import OpenAI
import base64
import time

class PaddleOCRVL:
    def __init__(self):
        self.client = OpenAI(
            api_key="EMPTY",
            base_url="https://u221364-95d5-e23dd712.westc.seetacloud.com:8443/v1/",
            timeout=3600
        )
        self.tasks = {
            "ocr": "OCR:",
            "table": "Table Recognition:",
            "formula": "Formula Recognition:",
            "chart": "Chart Recognition:",
        }
        self.output_formats = {
            "ocr": "纯文本格式",
            "table": "结构化标记语言",
            "formula": "格式化对齐文本",
            "chart": "表格化数据"
        }

    def recognize(self, image_url, task_type="ocr", verbose=False):
        """
        图像识别主函数 - 已通过完整测试验证

        Args:
            image_url (str): 图片URL或本地路径
            task_type (str): 任务类型 ('ocr', 'table', 'formula', 'chart')
            verbose (bool): 是否显示详细处理信息

        Returns:
            dict: 包含识别结果和元信息的字典
        """
        if task_type not in self.tasks:
            raise ValueError(f"不支持的任务类型: {task_type}. 支持的类型: {list(self.tasks.keys())}")

        if verbose:
            print(f"🚀 开始 {task_type.upper()} 识别...")
            print(f"📊 预期输出格式: {self.output_formats[task_type]}")

        # 处理本地图片
        if not image_url.startswith(('http://', 'https://')):
            image_url = self._encode_local_image(image_url)

        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": image_url}
                    },
                    {
                        "type": "text",
                        "text": self.tasks[task_type]
                    }
                ]
            }
        ]

        try:
            start_time = time.time()
            response = self.client.chat.completions.create(
                model="PaddleOCR-VL-0.9B",
                messages=messages,
                temperature=0.0,
            )
            end_time = time.time()
            processing_time = end_time - start_time

            result = {
                "success": True,
                "content": response.choices[0].message.content,
                "task_type": task_type,
                "processing_time": round(processing_time, 2),
                "output_format": self.output_formats[task_type]
            }

            if verbose:
                print(f"✅ 识别成功! 耗时: {processing_time:.2f}秒")

            return result

        except Exception as e:
            error_result = {
                "success": False,
                "error": str(e),
                "task_type": task_type,
                "processing_time": 0,
                "output_format": None
            }

            if verbose:
                print(f"❌ 识别失败: {e}")

            return error_result

    def batch_recognize(self, image_urls, task_type="ocr", verbose=False):
        """批量识别功能"""
        results = []
        for i, url in enumerate(image_urls):
            if verbose:
                print(f"\n处理第 {i+1}/{len(image_urls)} 张图片...")
            result = self.recognize(url, task_type, verbose)
            results.append(result)
            time.sleep(1)  # 避免请求过于频繁
        return results

    def _encode_local_image(self, image_path):
        """编码本地图片为 base64"""
        try:
            with open(image_path, "rb") as image_file:
                base64_image = base64.b64encode(image_file.read()).decode('utf-8')
                # 根据文件扩展名确定MIME类型
                if image_path.lower().endswith('.png'):
                    return f"data:image/png;base64,{base64_image}"
                else:
                    return f"data:image/jpeg;base64,{base64_image}"
        except Exception as e:
            raise ValueError(f"无法读取图片文件: {e}")

# 使用示例 - 基于实际测试验证
if __name__ == "__main__":
    ocr = PaddleOCRVL()

    # 测试用的收据图片URL
    test_image = "https://ofasys-multimodal-wlcb-3-toshanghai.oss-accelerate.aliyuncs.com/wpf272043/keepme/image/receipt.png"

    # OCR 识别
    result = ocr.recognize(test_image, "ocr", verbose=True)
    if result["success"]:
        print(f"OCR 结果:\n{result['content']}")

    # 表格识别
    result = ocr.recognize(test_image, "table", verbose=True)
    if result["success"]:
        print(f"表格识别结果:\n{result['content']}")

    # 图表识别
    result = ocr.recognize(test_image, "chart", verbose=True)
    if result["success"]:
        print(f"图表识别结果:\n{result['content']}")