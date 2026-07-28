"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type ComponentPropsWithoutRef,
} from "react";
import { AlignCenter, AlignLeft, AlignRight, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

const MIN_COL = 48;
const DEFAULT_COL = 140;
const ALIGN_CYCLE = ["left", "center", "right"] as const;
type ColAlign = (typeof ALIGN_CYCLE)[number];

type CellPos = { row: number; col: number };

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return "";
}

function isTag(el: ReactElement, tag: string): boolean {
  return typeof el.type === "string" && el.type === tag;
}

function extractHeaders(children: ReactNode): string[] {
  const list = Children.toArray(children);
  for (const child of list) {
    if (!isValidElement(child) || !isTag(child, "thead")) continue;
    const rows = Children.toArray(
      (child as ReactElement<{ children?: ReactNode }>).props.children,
    );
    for (const row of rows) {
      if (!isValidElement(row) || !isTag(row, "tr")) continue;
      const cells = Children.toArray(
        (row as ReactElement<{ children?: ReactNode }>).props.children,
      );
      const headers: string[] = [];
      for (const cell of cells) {
        if (!isValidElement(cell)) continue;
        if (isTag(cell, "th") || isTag(cell, "td")) {
          headers.push(textOf((cell as ReactElement<{ children?: ReactNode }>).props.children).trim());
        }
      }
      if (headers.length) return headers;
    }
  }
  return [];
}

function defaultAligns(n: number): ColAlign[] {
  return Array.from({ length: n }, () => "left" as ColAlign);
}

function nextAlign(current: ColAlign): ColAlign {
  const i = ALIGN_CYCLE.indexOf(current);
  return ALIGN_CYCLE[(i + 1) % ALIGN_CYCLE.length];
}

interface MarkdownTableProps extends ComponentPropsWithoutRef<"table"> {
  children?: ReactNode;
}

/**
 * Markdown 表格：列宽拖拽 + 列对齐（仅内存，刷新丢失）。
 * 选中为单元格级（Excel/Notion 风格），点表格外取消。
 */
export function MarkdownTable({
  children,
  className,
  ...props
}: MarkdownTableProps) {
  const headers = useMemo(() => extractHeaders(children), [children]);
  const colCount = headers.length;

  const [widths, setWidths] = useState<number[] | null>(null);
  const [aligns, setAligns] = useState<ColAlign[]>([]);
  const [selected, setSelected] = useState<CellPos | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const draggingRef = useRef<{
    col: number;
    startX: number;
    startWidths: number[];
  } | null>(null);

  const currentAligns = useMemo(() => {
    if (aligns.length === colCount && colCount > 0) return aligns;
    return defaultAligns(colCount);
  }, [aligns, colCount]);
  const activeCol = selected?.col ?? 0;

  const measureWidths = useCallback((): number[] => {
    const table = tableRef.current;
    if (!table || colCount === 0) {
      return Array.from({ length: colCount }, () => DEFAULT_COL);
    }
    const firstRow = table.querySelector("tr");
    if (!firstRow) return Array.from({ length: colCount }, () => DEFAULT_COL);
    const cells = firstRow.querySelectorAll("th, td");
    const measured: number[] = [];
    for (let i = 0; i < colCount; i++) {
      const cell = cells[i] as HTMLElement | undefined;
      const w = cell ? Math.round(cell.getBoundingClientRect().width) : DEFAULT_COL;
      measured.push(Math.max(MIN_COL, w || DEFAULT_COL));
    }
    return measured;
  }, [colCount]);

  const ensureWidths = useCallback((): number[] => {
    if (widths && widths.length === colCount) return widths;
    return measureWidths();
  }, [widths, colCount, measureWidths]);

  // 点表格外 / Esc：取消单元格选中
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const shell = shellRef.current;
      if (!shell) return;
      if (shell.contains(e.target as Node)) return;
      setSelected(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const onResizeWindowMove = useCallback((e: MouseEvent) => {
    const drag = draggingRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const nextWidths = [...drag.startWidths];
    nextWidths[drag.col] = Math.max(MIN_COL, Math.round(drag.startWidths[drag.col] + dx));
    setWidths(nextWidths);
  }, []);

  const onResizeWindowEnd = useCallback(() => {
    draggingRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", onResizeWindowMove);
  }, [onResizeWindowMove]);

  const startResize = useCallback(
    (col: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startWidths = ensureWidths();
      draggingRef.current = {
        col,
        startX: e.clientX,
        startWidths: [...startWidths],
      };
      setWidths(startWidths);
      setSelected({ row: 0, col });
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onResizeWindowMove);
      window.addEventListener("mouseup", onResizeWindowEnd, { once: true });
    },
    [ensureWidths, onResizeWindowEnd, onResizeWindowMove],
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onResizeWindowMove);
    };
  }, [onResizeWindowMove]);

  const setColAlign = useCallback(
    (col: number, align: ColAlign) => {
      if (colCount === 0) return;
      setAligns((prev) => {
        const next = [...(prev.length === colCount ? prev : defaultAligns(colCount))];
        next[col] = align;
        return next;
      });
      if (!widths || widths.length !== colCount) {
        setWidths(ensureWidths());
      }
    },
    [colCount, ensureWidths, widths],
  );

  const resetLayout = useCallback(() => {
    setWidths(null);
    setAligns(defaultAligns(colCount));
    setSelected(null);
  }, [colCount]);

  const enhancedChildren = useMemo(() => {
    if (colCount === 0) return children;
    let bodyRowIndex = 0;

    const mapRow = (
      row: ReactElement<{ children?: ReactNode }>,
      rowIndex: number,
      isHeader: boolean,
    ) => {
      const cells = Children.toArray(row.props.children);
      let colIndex = 0;
      const nextCells = cells.map((cell) => {
        if (!isValidElement(cell)) return cell;
        if (!isTag(cell, "th") && !isTag(cell, "td")) return cell;
        const i = colIndex++;
        const align = currentAligns[i] ?? "left";
        const isSelected = selected?.row === rowIndex && selected?.col === i;
        const cellEl = cell as ReactElement<{
          children?: ReactNode;
          className?: string;
          style?: CSSProperties;
          onClick?: (e: React.MouseEvent) => void;
        }>;
        const style: CSSProperties = {
          ...cellEl.props.style,
          textAlign: align,
        };

        if (isHeader) {
          return cloneElement(cellEl, {
            style,
            className: cn(
              cellEl.props.className,
              "kp-md-th",
              isSelected && "kp-md-cell-selected",
            ),
            onClick: (e: React.MouseEvent) => {
              cellEl.props.onClick?.(e);
              if ((e.target as HTMLElement).closest(".kp-md-col-resizer")) return;
              setSelected({ row: rowIndex, col: i });
            },
            children: (
              <>
                <span className="kp-md-th-label">{cellEl.props.children}</span>
                {i < colCount - 1 && (
                  <span
                    className="kp-md-col-resizer"
                    title="拖动调整列宽"
                    onMouseDown={(e) => startResize(i, e)}
                  />
                )}
              </>
            ),
          });
        }

        return cloneElement(cellEl, {
          style,
          className: cn(cellEl.props.className, isSelected && "kp-md-cell-selected"),
          onClick: (e: React.MouseEvent) => {
            cellEl.props.onClick?.(e);
            setSelected({ row: rowIndex, col: i });
          },
        });
      });
      return cloneElement(row, { children: nextCells });
    };

    return Children.map(children, (section) => {
      if (!isValidElement(section)) return section;
      if (!isTag(section, "thead") && !isTag(section, "tbody") && !isTag(section, "tfoot")) {
        return section;
      }
      const isHeaderSection = isTag(section, "thead");
      const sectionEl = section as ReactElement<{ children?: ReactNode }>;
      const rows = Children.map(sectionEl.props.children, (row) => {
        if (!isValidElement(row) || !isTag(row, "tr")) return row;
        const rowIndex = isHeaderSection ? 0 : ++bodyRowIndex;
        return mapRow(
          row as ReactElement<{ children?: ReactNode }>,
          rowIndex,
          isHeaderSection,
        );
      });
      return cloneElement(sectionEl, { children: rows });
    });
  }, [children, colCount, currentAligns, selected, startResize]);

  const totalWidth =
    widths && widths.length === colCount ? widths.reduce((a, b) => a + b, 0) : undefined;

  const tableStyle: CSSProperties = {
    tableLayout: widths ? "fixed" : "auto",
    width: totalWidth ? `${totalWidth}px` : "100%",
    minWidth: "100%",
  };

  const hasSelection = selected != null;

  return (
    <div
      ref={shellRef}
      className={cn("kp-md-table-shell not-prose", hasSelection && "is-focused")}
    >
      {hasSelection && (
        <div className="kp-md-table-toolbar">
          <div className="kp-md-table-toolbar-actions ml-auto">
            <button
              type="button"
              className={cn(
                "kp-md-table-btn",
                currentAligns[activeCol] === "left" && "is-active",
              )}
              title="当前列左对齐"
              onClick={() => setColAlign(activeCol, "left")}
            >
              <AlignLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={cn(
                "kp-md-table-btn",
                currentAligns[activeCol] === "center" && "is-active",
              )}
              title="当前列居中"
              onClick={() => setColAlign(activeCol, "center")}
            >
              <AlignCenter className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={cn(
                "kp-md-table-btn",
                currentAligns[activeCol] === "right" && "is-active",
              )}
              title="当前列右对齐"
              onClick={() => setColAlign(activeCol, "right")}
            >
              <AlignRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="kp-md-table-btn"
              title="切换当前列对齐"
              onClick={() => setColAlign(activeCol, nextAlign(currentAligns[activeCol] ?? "left"))}
            >
              切换
            </button>
            <button
              type="button"
              className="kp-md-table-btn"
              title="重置列宽与对齐"
              onClick={resetLayout}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
      <div className="kp-md-table-scroll">
        <table
          ref={tableRef}
          {...props}
          className={cn("kp-md-table", className)}
          style={tableStyle}
        >
          {widths && widths.length === colCount && (
            <colgroup>
              {widths.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
          )}
          {enhancedChildren}
        </table>
      </div>
    </div>
  );
}
