/**
 * ============================================================================
 * Markdown → 飞书 Docx Blocks 转换器
 * ============================================================================
 *
 * 将 Markdown 文本解析为飞书 docx API 所需的 block 结构数组. 
 * 支持块级元素(标题、列表、代码块、引用、表格、分割线)和行内格式
 * (粗体、斜体、删除线、行内代码、链接、公式). 
 *
 * 核心设计: 递归下降解析行内格式,支持嵌套;块级解析失败时降级为普通段落,
 * 避免单点错误导致整个文档无法写入. 
 *
 * 移植自 MetaBlog `src/theme/tools/lark/markdownToBlocks.ts`。
 *
 * @module infra/feishuMarkdownToBlocks
 */

/**
 * 飞书文本元素接口
 *
 * 统一表示 text_run(普通文本)和 equation(公式)两种元素. 
 */
export interface TextElement {
  text_run?: {
    content: string
    text_element_style?: {
      bold?: boolean
      italic?: boolean
      strikethrough?: boolean
      underline?: boolean
      inline_code?: boolean
      link?: { url: string }
    }
  }
  equation?: {
    content: string
    text_element_style?: {}
  }
}

// ============================================================
// 公共常量
// ============================================================

/** 零宽字符正则: 去除 BOM、零宽空格等不可见字符,避免解析异常 */
const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF\u2060]/g

/** 标题正则: # 后必须有空格,支持尾部 # */
const HEADING_RE = /^(#{1,9})\s+(.+?)(?:\s+#*)?$/

/** 无序列表 */
const BULLET_RE = /^(\s*)-\s+(.+)$/

/** 有序列表 */
const ORDERED_RE = /^(\s*)(\d+)\.\s+(.+)$/

/** 任务列表 */
const TODO_RE = /^(\s*)-\s+\[([ xX])\]\s+(.+)$/

/** 分割线: ---、***、___、* * * */
const DIVIDER_RE = /^(---+|\*\*\*|___|\*\s+\*\s+\*)\s*$/

/** 代码块起始 */
const CODE_FENCE_RE = /^```(.*)$/

// ============================================================
// 入口函数
// ============================================================

/**
 * Markdown 转换诊断结果
 */
export interface MarkdownConversionResult {
  blocks: any[]
  warnings: string[]
  stats: {
    inputLength: number
    outputBlockCount: number
    emptyBlockCount: number
    textBlockCount: number
    headingBlockCount: number
    listBlockCount: number
    codeBlockCount: number
    tableBlockCount: number
    dividerBlockCount: number
  }
  /** 每个 block 对应的原始 Markdown 行号映射 */
  lineMap: Array<{ blockIndex: number; blockType: number; startLine: number; endLine: number }>
  /** 无法识别/降级处理的 Markdown 格式 */
  unrecognizedFormats: Array<{ lineNumber: number; content: string; reason: string }>
}

/**
 * 将 Markdown 字符串转换为飞书 block 数组(带详细诊断)
 *
 * 执行流程: 输入验证 → 输入清洗 → 块级解析 → 合并相邻纯文本碎片 → 诊断报告
 * 合并步骤可减少飞书 API 接收的 element 数量,提升写入效率.
 *
 * @param markdown - 原始 Markdown 文本
 * @returns 转换结果, 包含 blocks 数组和 warnings 诊断信息
 * @throws 当输入严重非法时抛出错误(含详细原因)
 */
export function markdownToBlocksWithDiagnostics(markdown: string): MarkdownConversionResult {
  const warnings: string[] = []
  const unrecognizedFormats: Array<{ lineNumber: number; content: string; reason: string }> = []

  // 1. 输入验证
  if (markdown === undefined || markdown === null) {
    throw new Error('Markdown 转换失败: 输入为 null 或 undefined')
  }
  if (typeof markdown !== 'string') {
    throw new Error(`Markdown 转换失败: 输入类型应为 string, 实际得到 ${typeof markdown}`)
  }
  if (markdown.length === 0) {
    warnings.push('输入为空字符串, 未生成任何 block')
  }
  if (markdown.length > 500000) {
    warnings.push(`输入长度 ${markdown.length} 超过 500000 字符安全阈值, 可能导致性能问题`)
  }

  // 2. 输入清洗
  const cleaned = cleanInput(markdown)
  if (cleaned.length === 0 && markdown.length > 0) {
    warnings.push('输入清洗后为空(可能只包含不可见字符如 BOM、零宽字符)')
  }

  // 3. 块级解析(带行号信息)
  let parsed: Array<{ block: any; startLine: number; endLine: number; isFallback: boolean }>
  try {
    parsed = parseBlocksWithLineNumbers(cleaned, unrecognizedFormats)
  } catch (e: any) {
    throw new Error(`Markdown 块级解析失败: ${e?.message || String(e)}`)
  }

  const preFilterCount = parsed.length

  // 4. 合并 + 过滤
  const merged = parsed.map((p) => ({ ...p, block: mergeBlockTextElements(p.block) }))
  const filtered: typeof merged = []
  for (const item of merged) {
    const empty = isEmptyBlock(item.block)
    if (empty && item.block.block_type !== 22 && item.block.block_type !== 31) {
      // 记录被过滤的空 block 类型及行号
      warnings.push(`过滤空 block: type=${item.block.block_type || 'unknown'}, 行号 ${item.startLine}-${item.endLine}`)
    }
    if (!empty) {
      filtered.push(item)
    }
  }

  if (preFilterCount > 0 && filtered.length === 0) {
    warnings.push('所有 block 都被过滤掉了. 可能原因: 1) 内容只包含不可见字符; 2) 所有文本块内容为空; 3) 不支持的格式被全部丢弃')
  }

  // 5. 构建行号映射
  const lineMap = filtered.map((item, idx) => ({
    blockIndex: idx,
    blockType: item.block.block_type,
    startLine: item.startLine,
    endLine: item.endLine,
  }))

  // 6. 统计
  const blocks = filtered.map((item) => item.block)
  const stats = {
    inputLength: markdown.length,
    outputBlockCount: blocks.length,
    emptyBlockCount: preFilterCount - filtered.length,
    textBlockCount: blocks.filter((b: any) => b.block_type === 2).length,
    headingBlockCount: blocks.filter((b: any) => [3, 4, 5, 6, 7, 8, 9, 10, 11].includes(b.block_type)).length,
    listBlockCount: blocks.filter((b: any) => [12, 13, 17].includes(b.block_type)).length,
    codeBlockCount: blocks.filter((b: any) => b.block_type === 14).length,
    tableBlockCount: blocks.filter((b: any) => b.block_type === 31).length,
    dividerBlockCount: blocks.filter((b: any) => b.block_type === 22).length,
  }

  return { blocks, warnings, stats, lineMap, unrecognizedFormats }
}

/**
 * 将 Markdown 字符串转换为飞书 block 数组(兼容旧版, 无诊断信息)
 *
 * @param markdown - 原始 Markdown 文本
 * @returns 飞书 block 结构数组
 * @throws 转换失败时抛出详细错误
 */
export function markdownToBlocks(markdown: string): any[] {
  const result = markdownToBlocksWithDiagnostics(markdown)
  return result.blocks
}

/**
 * 判断 block 是否为空(无有效内容)
 *
 * 飞书 API 拒绝包含空 elements 数组或空 text_run.content 的 block,
 * 此类 block 会导致 1770032 错误. 过滤空 block 可避免整批写入失败. 
 *
 * @param block - 飞书 block 对象
 * @returns 是否为空 block
 */
function isEmptyBlock(block: any): boolean {
  if (!block || typeof block !== 'object') return true
  // 分割线、table 等非文本块不视为空
  if (block.block_type === 22 || block.block_type === 31) return false
  const blockType = Object.keys(block).find((k) => k !== 'block_type')
  if (!blockType) return true
  const data = block[blockType]
  if (!data) return true
  // 检查 elements 数组
  if (Array.isArray(data.elements)) {
    if (data.elements.length === 0) return true
    // 检查所有 text_run 是否内容为空
    const hasContent = data.elements.some((el: any) => {
      if (el.text_run && el.text_run.content && el.text_run.content.trim().length > 0) return true
      if (el.equation && el.equation.content && el.equation.content.trim().length > 0) return true
      return false
    })
    if (!hasContent) return true
  }
  return false
}

// ============================================================
// 输入清洗
// ============================================================

/**
 * 清洗输入文本,去除不可见字符并统一换行符
 *
 * 为什么需要: BOM 和零宽字符会导致正则匹配失败,\r\n 会导致行分割异常. 
 *
 * @param text - 原始输入文本
 * @returns 清洗后的文本
 */
function cleanInput(text: string): string {
  return text
    .replace(/^\uFEFF/, '') // 去除 BOM
    .replace(ZERO_WIDTH_CHARS, '') // 去除零宽字符
    .replace(/\r\n/g, '\n') // 统一换行符
    .replace(/\r/g, '\n')
}

// ============================================================
// 块级解析
// ============================================================

/**
 * 将 Markdown 文本解析为块级元素数组
 *
 * 逐行扫描,遇到块级元素开头时调用 parseBlock 解析,
 * 解析失败时降级为普通段落(不抛异常,保证鲁棒性). 
 *
 * @param markdown - 清洗后的 Markdown 文本
 * @returns 块级元素数组
 */
interface ParsedBlockWithLine {
  block: any
  startLine: number
  endLine: number
  isFallback: boolean
}

function parseBlocksWithLineNumbers(
  markdown: string,
  unrecognizedFormats: Array<{ lineNumber: number; content: string; reason: string }>
): ParsedBlockWithLine[] {
  const lines = markdown.split('\n')
  const blocks: ParsedBlockWithLine[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const startLine = i + 1 // 1-based line number for user-facing display

    // 空行直接跳过
    if (!line || line.trim() === '') {
      i++
      continue
    }

    // 检测潜在的未知格式(不是任何已知块级元素开头, 但看起来像某种格式)
    const looksLikeFormat = detectPotentialFormat(line)

    try {
      const result = parseBlock(lines, i)
      const endLine = result.nextIndex // nextIndex is 0-based, endLine in user terms
      blocks.push({ block: result.block, startLine, endLine, isFallback: false })
      i = result.nextIndex
    } catch {
      // 容错: 解析失败降级为普通段落,避免单点错误阻断整个流程
      const paraLines = [line]
      i++
      while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
        paraLines.push(lines[i])
        i++
      }
      const endLine = i
      if (looksLikeFormat) {
        unrecognizedFormats.push({
          lineNumber: startLine,
          content: line.slice(0, 100),
          reason: `疑似 ${looksLikeFormat} 格式, 但解析失败已降级为普通段落. 请检查语法是否正确`,
        })
      }
      blocks.push({
        block: {
          block_type: 2,
          text: { elements: [{ text_run: { content: paraLines.join('\n') } }] },
        },
        startLine,
        endLine,
        isFallback: true,
      })
    }
  }

  return blocks
}

/**
 * 检测一行是否像某种已知格式但语法可能错误
 *
 * 用于在降级为普通段落时给出警告, 帮助用户发现格式问题.
 */
function detectPotentialFormat(line: string): string | undefined {
  const trimmed = line.trim()
  // 看起来像标题但 # 后没有空格
  if (/^#{1,9}[^\s]/.test(trimmed)) return '标题(缺少 # 后的空格)'
  // 看起来像列表但格式不对
  if (/^(\s*)[\*\+]\s/.test(trimmed)) return '列表(用了 * 或 +, 应使用 - )'
  // 看起来像任务列表但格式不对
  if (/^(\s*)-\s*\[[^ xX]\]/.test(trimmed)) return '任务列表(复选框格式错误, 应为 [ ] 或 [x])'
  // 看起来像代码块但没有闭合
  if (/^```/.test(trimmed) && trimmed.length > 3) return '代码块(语法可能不完整)'
  // 看起来像表格但缺少分隔行
  if (/^\s*\|.*\|\s*$/.test(trimmed) && !isTableDivider(trimmed)) return '表格(可能缺少分隔行 |---|---|)'
  // HTML 标签
  if (/^\s*<[a-zA-Z][^>]*>/.test(trimmed)) return 'HTML 标签(飞书不支持 HTML, 应使用 Markdown 语法)'
  return undefined
}

/**
 * 解析单行/多行块级元素
 *
 * 按优先级依次匹配: 块级公式 > 代码块 > 标题 > 任务列表 > 无序列表 >
 * 有序列表 > 引用块 > 分割线 > 表格 > 普通段落. 
 *
 * @param lines - 全文行数组
 * @param i - 当前行索引
 * @returns 解析结果,包含 block 和下一行索引
 */
function parseBlock(lines: string[], i: number): { block: any; nextIndex: number } {
  const line = lines[i]

  // --- 块级公式 $$...$$(支持多行和单行) ---
  if (line === '$$') {
    const formulaLines: string[] = []
    i++
    while (i < lines.length && lines[i] !== '$$') {
      formulaLines.push(lines[i])
      i++
    }
    return {
      block: {
        block_type: 2,
        text: {
          elements: [{ equation: { content: formulaLines.join('\n') } }],
        },
      },
      nextIndex: i + 1,
    }
  }

  // 单行块级公式: $$\nabla J(\theta) = ...$$
  const singleLineEqMatch = line.match(/^\$\$(.+)\$\$$/)
  if (singleLineEqMatch) {
    return {
      block: {
        block_type: 2,
        text: {
          elements: [{ equation: { content: singleLineEqMatch[1] } }],
        },
      },
      nextIndex: i + 1,
    }
  }

  // --- 代码块 ---
  const codeMatch = line.match(CODE_FENCE_RE)
  if (codeMatch) {
    const lang = codeMatch[1].trim()
    const codeLines: string[] = []
    i++
    while (i < lines.length && !CODE_FENCE_RE.test(lines[i])) {
      codeLines.push(lines[i])
      i++
    }
    const block: any = {
      block_type: 14,
      code: { elements: [{ text_run: { content: codeLines.join('\n') } }] },
    }
    if (lang) block.code.style = { language: mapCodeLanguage(lang) }
    return { block, nextIndex: i + 1 }
  }

  // --- 标题 ---
  const headingMatch = line.match(HEADING_RE)
  if (headingMatch) {
    const level = Math.min(headingMatch[1].length, 9)
    return {
      block: {
        block_type: 2 + level,
        [`heading${level}`]: {
          elements: parseInlineElements(headingMatch[2]),
        },
      },
      nextIndex: i + 1,
    }
  }

  // --- 任务列表 ---
  const todoMatch = line.match(TODO_RE)
  if (todoMatch) {
    return {
      block: {
        block_type: 17,
        todo: {
          elements: parseInlineElements(todoMatch[3]),
          style: { done: todoMatch[2].toLowerCase() === 'x' },
        },
      },
      nextIndex: i + 1,
    }
  }

  // --- 无序列表 ---
  const bulletMatch = line.match(BULLET_RE)
  if (bulletMatch) {
    return {
      block: {
        block_type: 12,
        bullet: { elements: parseInlineElements(bulletMatch[2]) },
      },
      nextIndex: i + 1,
    }
  }

  // --- 有序列表 ---
  const orderedMatch = line.match(ORDERED_RE)
  if (orderedMatch) {
    return {
      block: {
        block_type: 13,
        ordered: { elements: parseInlineElements(orderedMatch[3]) },
      },
      nextIndex: i + 1,
    }
  }

  // --- 引用块(支持嵌套)---
  if (line.startsWith('>')) {
    const quoteLines: string[] = []
    while (i < lines.length && lines[i].startsWith('>')) {
      // 去除引用标记,保留嵌套层级用于缩进感知(简单实现: 只去一层)
      const stripped = lines[i].replace(/^>\s?/, '')
      quoteLines.push(stripped)
      i++
    }
    return {
      block: {
        block_type: 15,
        quote: { elements: parseInlineElements(quoteLines.join('\n')) },
      },
      nextIndex: i,
    }
  }

  // --- 分割线 ---
  if (DIVIDER_RE.test(line)) {
    return { block: { block_type: 22, divider: {} }, nextIndex: i + 1 }
  }

  // --- 表格（缺 GFM 分隔行时自动补齐，避免 LLM 漏写 |---| 变成一坨管道符）---
  if (isTableLine(line)) {
    const tableLines: string[] = [line]
    let j = i + 1
    while (j < lines.length && isTableLine(lines[j])) {
      tableLines.push(lines[j])
      j++
    }
    const normalized = ensureMarkdownTableDivider(tableLines)
    if (normalized) {
      const parsed = parseMarkdownTable(normalized)
      if (parsed) {
        return { block: parsed, nextIndex: j }
      }
      // 解析失败降级为文本
      return {
        block: {
          block_type: 2,
          text: { elements: [{ text_run: { content: tableLines.join('\n') } }] },
        },
        nextIndex: j,
      }
    }
  }

  // --- 普通段落 ---
  const paraLines: string[] = [line]
  i++
  while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
    paraLines.push(lines[i])
    i++
  }
  return {
    block: {
      block_type: 2,
      text: { elements: parseInlineElements(paraLines.join('\n')) },
    },
    nextIndex: i,
  }
}

/**
 * 判断一行是否是块级元素的开头
 *
 * 用于普通段落解析时判断是否继续吸收后续行. 
 *
 * @param line - 待判断的行文本
 * @returns 是否是块级元素开头
 */
function isBlockStart(line: string): boolean {
  return (
    line === '$$' ||
    /^\$\$.+\$\$$/.test(line) ||
    HEADING_RE.test(line) ||
    CODE_FENCE_RE.test(line) ||
    TODO_RE.test(line) ||
    BULLET_RE.test(line) ||
    ORDERED_RE.test(line) ||
    line.startsWith('>') ||
    DIVIDER_RE.test(line) ||
    isTableLine(line)
  )
}

/**
 * 判断一行是否是表格行
 *
 * 以 | 开头或结尾的行视为表格行. 
 *
 * @param line - 待判断的行文本
 * @returns 是否是表格行
 */
function isTableLine(line: string): boolean {
  return /^\s*\|/.test(line) || /\|\s*$/.test(line)
}

/**
 * 判断一行是否是表格分隔行
 *
 * 格式如 |---|---| 的分隔行. 
 *
 * @param line - 待判断的行文本
 * @returns 是否是表格分隔行
 */
function isTableDivider(line: string): boolean {
  return /^\s*\|?[-:\|\s]+\|?\s*$/.test(line)
}

/**
 * 规范化 Markdown 表格行：若缺 GFM 第二行分隔符且各行列数一致，则自动插入。
 * 返回 null 表示不像表格（单行管道符 / 列数不一致）。
 */
function ensureMarkdownTableDivider(lines: string[]): string[] | null {
  if (lines.length < 2) return null
  if (isTableDivider(lines[1])) return lines

  const colCount = splitTableCells(lines[0]).length
  if (colCount === 0) return null
  for (let r = 1; r < lines.length; r++) {
    if (isTableDivider(lines[r])) continue
    if (splitTableCells(lines[r]).length !== colCount) return null
  }
  const divider = `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`
  return [lines[0], divider, ...lines.slice(1)]
}

/**
 * 清理表格单元格中的 equation 元素,处理飞书 table cell 渲染兼容性问题
 *
 * 问题: 飞书 table cell 中的 equation 元素会将 `\\` 解释为 LaTeX 换行符,
 * 导致公式被强制换行显示,且可能破坏单元格布局. 
 *
 * 降级策略: 包含 `\\` 的 equation 降级为普通 text_run(用 \( ... \) 包裹),
 * 同时去掉末尾的 `\\` 并将内部的 `\\` 替换为空格. 
 *
 * @param elements - 单元格内的 TextElement 数组
 * @returns 清理后的 TextElement 数组
 */
function sanitizeTableCellEquations(elements: TextElement[]): TextElement[] {
  return elements.map((el) => {
    if (el.equation && el.equation.content.includes('\\\\')) {
      let content = el.equation.content
      // 去掉末尾的一个或多个 \\
      content = content.replace(/\\\\+\s*$/, '')
      // 将内部的 \\\\ 替换为空格(避免 LaTeX 换行)
      content = content.replace(/\\\\/g, ' ')
      return { text_run: { content: `\\\\(${content}\\\\)` } }
    }
    return el
  })
}

/**
 * 估算文本在飞书文档中的渲染宽度(像素)
 *
 * 中文字符/全角符号按 14px 估算,英文/数字/半角符号按 8px 估算,
 * 加上单元格左右 padding(32px). 
 *
 * @param text - 纯文本内容
 * @returns 估算宽度(px)
 */
function estimateTextWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    // 中文 CJK 字符、全角标点符号
    if (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch)) {
      width += 14
    } else {
      width += 8
    }
  }
  return width + 32 // 左右 padding
}

/**
 * 根据表格内容计算每列的推荐宽度
 *
 * 取每列所有单元格(含表头)的最大估算宽度,
 * 限制在 [60, 500] px 范围内. 
 *
 * @param lines - 表格的所有行(含表头和分隔行)
 * @param colCount - 列数
 * @returns 每列宽度数组(px)
 */
function estimateColumnWidths(lines: string[], colCount: number): number[] {
  const widths = new Array(colCount).fill(0)

  for (let r = 0; r < lines.length; r++) {
    // 跳过分隔行
    if (r === 1) continue
    const cells = splitTableCells(lines[r])
    for (let c = 0; c < colCount; c++) {
      const raw = cells[c] || ''
      // 去掉 Markdown 行内格式标记(**、*、` 等)得到纯文本长度
      const plain = raw
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/`/g, '')
        .replace(/~~/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      const w = estimateTextWidth(plain)
      widths[c] = Math.max(widths[c], w)
    }
  }

  return widths.map((w) => {
    if (w < 60) return 60
    if (w > 500) return 500
    return Math.round(w)
  })
}

/**
 * 解析 Markdown 表格为飞书 table block
 *
 * 返回结构包含 _cell_contents(TextElement[][],行优先),
 * 由后端拆分为: 创建 table + POST text children 到每个 cell. 
 *
 * @param lines - 表格的所有行(含表头和分隔行)
 * @returns 飞书 table block 或 null(解析失败)
 */
function parseMarkdownTable(lines: string[]): any | null {
  if (lines.length < 2) return null

  const headerCells = splitTableCells(lines[0])
  const colCount = headerCells.length
  if (colCount === 0) return null

  // 第二行必须是分隔行
  if (!isTableDivider(lines[1])) return null

  const cellContents: TextElement[][] = []

  // 表头行
  for (const cell of headerCells) {
    cellContents.push(sanitizeTableCellEquations(parseInlineElements(cell)))
  }

  // 数据行
  for (let r = 2; r < lines.length; r++) {
    const cells = splitTableCells(lines[r])
    for (let c = 0; c < colCount; c++) {
      const cellContent = cells[c] || ''
      cellContents.push(sanitizeTableCellEquations(parseInlineElements(cellContent)))
    }
  }

  const rowCount = lines.length - 1 // 去掉分隔行

  // 飞书 docx API 硬限制: 单个表格的行数和列数均不能超过 9
  // 即最多 9 行(含表头) × 9 列, 超过会报 1770011 (too many table cell) 或 1770034
  // 这里直接降级为普通文本, 避免导致整批 blocks 写入失败
  const MAX_TABLE_ROWS = 9
  const MAX_TABLE_COLS = 9
  if (rowCount > MAX_TABLE_ROWS || colCount > MAX_TABLE_COLS) {
    return null
  }

  const columnWidths = estimateColumnWidths(lines, colCount)

  return {
    block_type: 31,
    table: {
      property: {
        column_size: colCount,
        row_size: rowCount,
        column_width: columnWidths,
      },
    },
    _cell_contents: cellContents,
  }
}

/**
 * 按 | 分割表格行,去除首尾空格
 *
 * 关键修正: 
 * 1. 识别并保护 $...$ / $$...$$ 公式内的 |,防止公式被拆分到不同单元格
 * 2. 支持 Markdown 标准转义序列 \|,将其还原为普通 |
 *
 * @param line - 表格行文本
 * @returns 单元格内容数组
 */
function splitTableCells(line: string): string[] {
  let content = line.trim()
  if (content.startsWith('|')) content = content.slice(1)
  if (content.endsWith('|')) content = content.slice(0, -1)

  const cells: string[] = []
  let current = ''
  let i = 0

  while (i < content.length) {
    const ch = content[i]

    // 处理 Markdown 转义序列 \| → |
    if (ch === '\\' && content[i + 1] === '|') {
      current += '|'
      i += 2
      continue
    }

    // 保护公式中的 |: 遇到 $ 进入公式模式,直到找到匹配的 $ 退出
    if (ch === '$') {
      const isBlockFormula = content[i + 1] === '$'
      const endMarker = isBlockFormula ? '$$' : '$'
      current += ch
      if (isBlockFormula) current += '$'
      i += isBlockFormula ? 2 : 1

      // 查找公式结束标记(注意: 不支持嵌套公式)
      while (i < content.length) {
        if (content.substring(i, i + endMarker.length) === endMarker) {
          current += endMarker
          i += endMarker.length
          break
        }
        current += content[i]
        i++
      }
      continue
    }

    // 列分隔符(公式外的 |)
    if (ch === '|') {
      cells.push(current.trim())
      current = ''
      i++
      continue
    }

    current += ch
    i++
  }

  if (current || cells.length > 0) {
    cells.push(current.trim())
  }

  return cells
}

// ============================================================
// 行内解析(递归下降,支持嵌套)
// ============================================================

/**
 * 解析行内 Markdown 格式为 TextElement 数组
 *
 * @param text - 单行文本
 * @returns TextElement 数组
 */
function parseInlineElements(text: string): TextElement[] {
  return parseInline(text, 0)
}

/**
 * 递归下降解析行内格式
 *
 * 优先级: Link > Code > Bold > Italic > Strikethrough > PlainText. 
 * 高优先级先匹配,避免低优先级格式错误截断高优先级内容. 
 *
 * @param text - 待解析文本
 * @param start - 起始解析位置
 * @returns TextElement 数组
 */
function parseInline(text: string, start: number): TextElement[] {
  const elements: TextElement[] = []
  let i = start

  while (i < text.length) {
    // 优先级 1: Link [text](url)
    const link = tryParseLink(text, i)
    if (link) {
      const inner = parseInline(link.innerText, 0)
      elements.push(...applyStyle(inner, 'link', link.url))
      i = link.endPos
      continue
    }

    // 优先级 2: Code `text`(内部不解析)
    const code = tryParseCode(text, i)
    if (code) {
      elements.push({
        text_run: {
          content: code.text,
          text_element_style: { inline_code: true },
        },
      })
      i = code.endPos
      continue
    }

    // 优先级 3: Bold **text**
    const bold = tryParseBold(text, i)
    if (bold) {
      const inner = parseInline(bold.innerText, 0)
      elements.push(...applyStyle(inner, 'bold'))
      i = bold.endPos
      continue
    }

    // 优先级 4: Italic *text*(避免匹配 ** 内部的单个 *)
    const italic = tryParseItalic(text, i)
    if (italic) {
      const inner = parseInline(italic.innerText, 0)
      elements.push(...applyStyle(inner, 'italic'))
      i = italic.endPos
      continue
    }

    // 优先级 5: Strikethrough ~~text~~
    const strike = tryParseStrikethrough(text, i)
    if (strike) {
      const inner = parseInline(strike.innerText, 0)
      elements.push(...applyStyle(inner, 'strikethrough'))
      i = strike.endPos
      continue
    }

    // 优先级 6: 行内公式 $...$(避免匹配 $$ 开头的块级公式)
    const eq = tryParseEquation(text, i)
    if (eq) {
      elements.push({ equation: { content: eq.content } })
      i = eq.endPos
      continue
    }

    // 普通文本: 收集连续非标记字符
    const plainStart = i
    while (i < text.length && !isInlineMarkerStart(text, i)) {
      i++
    }
    if (i > plainStart) {
      elements.push({
        text_run: { content: text.slice(plainStart, i) },
      })
    } else {
      // 当前位置是标记开头但没匹配成功,当作普通字符
      elements.push({ text_run: { content: text[i] } })
      i++
    }
  }

  const merged = mergePlainText(elements)
  // Markdown 转义还原: \_ → _ 等, 但不处理 equation 元素
  return merged.map(el => {
    if (el.text_run) {
      return {
        text_run: {
          content: unescapeMarkdown(el.text_run.content),
          text_element_style: el.text_run.text_element_style,
        }
      }
    }
    return el
  })
}

/**
 * 判断当前位置是否是行内标记的开头
 *
 * @param text - 完整文本
 * @param i - 当前字符索引
 * @returns 是否是标记开头
 */
function isInlineMarkerStart(text: string, i: number): boolean {
  const ch = text[i]
  return (
    ch === '[' ||
    ch === '`' ||
    ch === '$' ||
    (ch === '*' && text[i + 1] === '*') ||
    (ch === '*' && text[i + 1] !== '*') ||
    (ch === '~' && text[i + 1] === '~')
  )
}

// ----- 行内标记解析器 -----

/**
 * 尝试解析链接 [text](url)
 *
 * 支持嵌套方括号,如 [[nested]](url). 
 *
 * @param text - 完整文本
 * @param i - 当前位置
 * @returns 解析结果或 null
 */
function tryParseLink(text: string, i: number): { pos: number; innerText: string; url: string; endPos: number } | null {
  if (text[i] !== '[') return null

  // 找匹配的 ]
  let depth = 1
  let j = i + 1
  while (j < text.length && depth > 0) {
    if (text[j] === '\\') { j += 2; continue }
    if (text[j] === '[') depth++
    else if (text[j] === ']') depth--
    j++
  }
  if (depth !== 0) return null
  const closeBracket = j - 1

  // 后面必须紧跟 (
  if (text[j] !== '(') return null

  // 找匹配的 )
  depth = 1
  j++
  while (j < text.length && depth > 0) {
    if (text[j] === '\\') { j += 2; continue }
    if (text[j] === '(') depth++
    else if (text[j] === ')') depth--
    j++
  }
  if (depth !== 0) return null
  const closeParen = j - 1

  return {
    pos: i,
    innerText: text.slice(i + 1, closeBracket),
    url: text.slice(closeBracket + 2, closeParen),
    endPos: j,
  }
}

/**
 * 尝试解析行内代码 `text`
 *
 * @param text - 完整文本
 * @param i - 当前位置
 * @returns 解析结果或 null
 */
function tryParseCode(text: string, i: number): { text: string; endPos: number } | null {
  if (text[i] !== '`') return null
  const end = text.indexOf('`', i + 1)
  if (end === -1 || end === i + 1) return null
  return { text: text.slice(i + 1, end), endPos: end + 1 }
}

/**
 * 尝试解析粗体 **text**
 *
 * @param text - 完整文本
 * @param i - 当前位置
 * @returns 解析结果或 null
 */
function tryParseBold(text: string, i: number): { innerText: string; endPos: number } | null {
  if (text.slice(i, i + 2) !== '**') return null
  const end = text.indexOf('**', i + 2)
  if (end === -1 || end === i + 2) return null
  return { innerText: text.slice(i + 2, end), endPos: end + 2 }
}

/**
 * 尝试解析斜体 *text*
 *
 * 注意避免匹配 ** 内部的单个 *. 
 *
 * @param text - 完整文本
 * @param i - 当前位置
 * @returns 解析结果或 null
 */
function tryParseItalic(text: string, i: number): { innerText: string; endPos: number } | null {
  if (text[i] !== '*' || text.slice(i, i + 2) === '**') return null
  const end = text.indexOf('*', i + 1)
  if (end === -1 || end === i + 1 || text.slice(end, end + 2) === '**') return null
  return { innerText: text.slice(i + 1, end), endPos: end + 1 }
}

/**
 * 尝试解析删除线 ~~text~~
 *
 * @param text - 完整文本
 * @param i - 当前位置
 * @returns 解析结果或 null
 */
function tryParseStrikethrough(text: string, i: number): { innerText: string; endPos: number } | null {
  if (text.slice(i, i + 2) !== '~~') return null
  const end = text.indexOf('~~', i + 2)
  if (end === -1 || end === i + 2) return null
  return { innerText: text.slice(i + 2, end), endPos: end + 2 }
}

/**
 * 尝试解析行内公式 $...$
 *
 * 优先匹配 $$...$$(常见于列表项/段落中的块级公式写法). 
 *
 * @param text - 完整文本
 * @param i - 当前位置
 * @returns 解析结果或 null
 */
function tryParseEquation(text: string, i: number): { content: string; endPos: number } | null {
  if (text[i] !== '$') return null

  // 优先匹配 $$...$$
  if (text.slice(i, i + 2) === '$$') {
    const end = text.indexOf('$$', i + 2)
    if (end !== -1 && end > i + 2) {
      return { content: text.slice(i + 2, end), endPos: end + 2 }
    }
    return null
  }

  // 普通 $...$ 行内公式
  const end = text.indexOf('$', i + 1)
  if (end === -1 || end === i + 1) return null
  return { content: text.slice(i + 1, end), endPos: end + 1 }
}

// ----- 样式应用 -----

/**
 * 为 TextElement 数组应用指定样式
 *
 * equation 元素不应用任何样式,保持原样. 
 *
 * @param elements - 待应用样式的元素数组
 * @param type - 样式类型(bold/italic/strikethrough/link)
 * @param url - 链接 URL(仅 link 类型需要)
 * @returns 应用样式后的元素数组
 */
function applyStyle(elements: TextElement[], type: string, url?: string): TextElement[] {
  return elements.map((el) => {
    // equation 元素不应用任何样式
    if (el.equation) return el

    const style = { ...(el.text_run!.text_element_style || {}) }
    switch (type) {
      case 'bold':
        style.bold = true
        break
      case 'italic':
        style.italic = true
        break
      case 'strikethrough':
        style.strikethrough = true
        break
      case 'link':
        if (url) style.link = { url }
        break
    }
    return {
      text_run: { content: el.text_run!.content, text_element_style: style },
    }
  })
}

/**
 * 合并相邻的普通文本元素,减少碎片
 *
 * 只有无样式的纯 text_run 才参与合并,有样式的元素保持独立. 
 *
 * @param elements - TextElement 数组
 * @returns 合并后的数组
 */
function mergePlainText(elements: TextElement[]): TextElement[] {
  const result: TextElement[] = []
  let current = ''

  for (const el of elements) {
    // 只有无样式的纯 text_run 才参与合并
    if (
      el.text_run &&
      (!el.text_run.text_element_style || Object.keys(el.text_run.text_element_style).length === 0)
    ) {
      current += el.text_run.content
    } else {
      if (current) {
        result.push({ text_run: { content: current } })
        current = ''
      }
      result.push(el)
    }
  }

  if (current) {
    result.push({ text_run: { content: current } })
  }

  return result
}

/**
 * Markdown 转义字符还原
 *
 * 将 Markdown 转义序列(如 \_、\*、\` 等)还原为原始字符.
 * 注意: 不处理 equation 元素, 因为 LaTeX 中的 \ 是命令前缀.
 */
const ESCAPABLE_CHARS = /\\([\\`*_{}[\]()#+\-.!|$~])/g
function unescapeMarkdown(text: string): string {
  return text.replace(ESCAPABLE_CHARS, '$1')
}

/**
 * 合并 block 内部的相邻纯 text_run
 *
 * @param block - 飞书 block 对象
 * @returns 合并后的 block 对象
 */
function mergeBlockTextElements(block: any): any {
  const blockType = Object.keys(block).find((k) => k !== 'block_type')
  if (!blockType) return block

  const data = block[blockType]
  if (!data || !Array.isArray(data.elements)) return block

  return {
    ...block,
    [blockType]: {
      ...data,
      elements: mergePlainText(data.elements),
    },
  }
}

// ============================================================
// 代码语言映射
// ============================================================

/**
 * 将代码语言字符串映射为飞书 API 对应的数字编码
 *
 * 飞书使用数字标识代码语言,而非字符串. 
 * 未知语言默认返回 1(plaintext). 
 *
 * @param lang - 代码语言字符串(如 "typescript", "python")
 * @returns 飞书语言编码数字
 */
function mapCodeLanguage(lang: string): number {
  const map: Record<string, number> = {
    plaintext: 1,
    abap: 2,
    ada: 3,
    apache: 4,
    apex: 5,
    assembly: 6,
    bash: 7,
    sh: 7,
    shell: 60,
    zsh: 7,
    csharp: 8,
    cs: 8,
    'c#': 8,
    cpp: 9,
    'c++': 9,
    c: 10,
    cobol: 11,
    css: 12,
    coffeescript: 13,
    coffee: 13,
    d: 14,
    dart: 15,
    delphi: 16,
    django: 17,
    dockerfile: 18,
    docker: 18,
    erlang: 19,
    fortran: 20,
    foxpro: 21,
    go: 22,
    golang: 22,
    groovy: 23,
    html: 24,
    htmlbars: 25,
    http: 26,
    haskell: 27,
    json: 28,
    java: 29,
    javascript: 30,
    js: 30,
    jsx: 30,
    julia: 31,
    kotlin: 32,
    latex: 33,
    lisp: 34,
    logo: 35,
    lua: 36,
    matlab: 37,
    makefile: 38,
    markdown: 39,
    md: 39,
    nginx: 40,
    objective: 41,
    objectivec: 41,
    openedgeabl: 42,
    php: 43,
    perl: 44,
    postscript: 45,
    power: 46,
    powershell: 46,
    prolog: 47,
    protobuf: 48,
    python: 49,
    py: 49,
    r: 50,
    rpg: 51,
    ruby: 52,
    rb: 52,
    rust: 53,
    sas: 54,
    scss: 55,
    sql: 56,
    scala: 57,
    scheme: 58,
    scratch: 59,
    swift: 61,
    thrift: 62,
    typescript: 63,
    ts: 63,
    tsx: 63,
    vbscript: 64,
    visual: 65,
    xml: 66,
    yaml: 67,
    yml: 67,
    cmake: 68,
    diff: 69,
    gherkin: 70,
    graphql: 71,
    glsl: 72,
    properties: 73,
    solidity: 74,
    toml: 75,
  }
  return map[lang.toLowerCase()] || 1
}
