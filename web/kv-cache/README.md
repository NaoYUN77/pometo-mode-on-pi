# KV cache 教学页
一个讲清 LLM 推理时 KV cache 占多少显存、为什么 decode 受带宽约束的中文静态页面。
双击 `index.html` 打开，不需要构建、不需要网络，脚本与样式都在同目录。
所有数字由 `2 × layers × kv_heads × head_dim × tokens × bytes` 推得，模型参数与各档上下文体积取自 `BUILD-BRIEF.md` 的表格。
`app.js` 是一份经典脚本：浏览器用 `<script src="app.js" defer>` 加载，Node 通过 `module.exports` 拿到同一份函数。全页只有这一份代码，没有内联副本。
页面不引用任何外部脚本、字体或图片，九个 arXiv 链接是仅有的外部跳转。
