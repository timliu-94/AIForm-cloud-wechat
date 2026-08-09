from openai import OpenAI

# 1. 初始化客户端，替换 YOUR_API_KEY
client = OpenAI(
    api_key="sk-3ed8e13b5a3a45a78754cf73ed4ea77b", 
    base_url="https://api.deepseek.com"
)
ocr_blocks = "1. Cognome / Surname (Family name) / 姓: ___"
# 2. 准备对话消息
messages = [
    {"role": "system", "content": """你是一个 PDF 表单字段识别助手。根据输入的 OCR 文字块，识别表格中需要用户填写或选择的内容，并合并属于同一字段的相邻文字。

对每个字段输出：

field_name：字段名称，使用简洁中文，如“姓名”“性别”“电子邮箱”“护照类型”“费用类型”
input_type：语义类型例如普通文本、日期、国家或地区、电话、金额、地址、护照号码、单选、多选、单选+文本、多选+文本，仅有以上选择类型；

忽略标题、说明文字、页码和纯装饰内容。不要推测 OCR 中没有出现的选项。无法确定时，将 field_name 标记为“待确认”。

仅输出中文 JSON 数组，不要解释。
"""},
    {"role": "user", "content": ocr_blocks}
]

# 3. 发起请求
response = client.chat.completions.create(
    model="deepseek-v4-flash",  # 使用 deepseek-chat 模型
    messages=messages,
    temperature=0.7,        # 控制随机性，范围 0-2
    max_tokens=2000,         # 最大输出长度
    response_format={"type": "json_object"} 
)

# 4. 打印结果
print(response.choices[0].message.content)