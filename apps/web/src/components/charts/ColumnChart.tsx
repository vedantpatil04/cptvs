import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { niceTicks, topRoundedRect } from './chart-geometry';
import { useElementWidth } from './use-element-width';

export interface ChartSeries {
  key: string;
  label: string;
  /** CSS colour of the marks (a `--chart-N` token). Never used for text. */
  color: string;
  values: number[];
}

interface ColumnChartProps {
  /** Accessible name of the chart. */
  title: string;
  /** X-axis category labels, one per column. */
  categories: string[];
  /** Column header for the categories in the table view. */
  categoryHeader: string;
  /** One series draws simple columns; several are stacked bottom-up in order. */
  series: ChartSeries[];
  formatValue: (value: number) => string;
  /** Plot height in px (the axis band is added below it). */
  plotHeight?: number;
}

const MARGIN = { top: 20, right: 8, bottom: 24, left: 36 };
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

/**
 * Hand-built SVG column chart: thin columns with a rounded data end, recessive
 * hairline grid, a per-column tooltip (pointer and arrow keys), a legend for
 * two or more series, a direct label on the peak only, and a table view.
 */
export function ColumnChart({
  title,
  categories,
  categoryHeader,
  series,
  formatValue,
  plotHeight = 180,
}: ColumnChartProps) {
  const { t } = useTranslation();
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();

  const totals = categories.map((_, index) =>
    series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0),
  );
  const ticks = niceTicks(Math.max(...totals, 0));
  const maxTick = ticks[ticks.length - 1] ?? 1;
  const peak = totals.reduce(
    (best, value, index) => (value > (totals[best] ?? 0) ? index : best),
    0,
  );

  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 0);
  const band = categories.length > 0 ? plotWidth / categories.length : 0;
  const barWidth = Math.max(Math.min(MAX_BAR, band - GAP), 2);
  const labelEvery = band >= 28 ? 1 : band >= 14 ? 3 : 6;
  const y = (value: number) => MARGIN.top + plotHeight - (value / maxTick) * plotHeight;
  const height = MARGIN.top + plotHeight + MARGIN.bottom;

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const last = categories.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? Math.min((active ?? -1) + 1, last)
        : event.key === 'ArrowLeft'
          ? Math.max((active ?? last + 1) - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  };

  const activeLeft = active === null ? 0 : MARGIN.left + band * active + band / 2;

  return (
    <figure className="space-y-3">
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {series.map((item) => (
            <li key={item.key} className="flex items-center gap-2">
              <span
                className="size-3 rounded-[3px]"
                style={{ backgroundColor: item.color }}
                aria-hidden
              />
              {item.label}
            </li>
          ))}
        </ul>
      )}
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-labelledby={titleId}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
            className="overflow-visible rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <title id={titleId}>{title}</title>
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={MARGIN.left + plotWidth}
                  y1={y(tick)}
                  y2={y(tick)}
                  className={tick === 0 ? 'stroke-muted-foreground/40' : 'stroke-border'}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={MARGIN.left - 8}
                  y={y(tick)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {formatValue(tick)}
                </text>
              </g>
            ))}
            {categories.map((category, index) => {
              const x = MARGIN.left + band * index + (band - barWidth) / 2;
              let base = 0;
              const visible = series.filter((item) => (item.values[index] ?? 0) > 0);
              return (
                <g
                  key={category}
                  opacity={active === null || active === index ? 1 : 0.55}
                  onPointerEnter={() => setActive(index)}
                >
                  {visible.map((item, position) => {
                    const value = item.values[index] ?? 0;
                    const top = y(base + value);
                    // A 2px surface gap separates stacked segments.
                    const bottom = y(base) - (position > 0 ? GAP : 0);
                    base += value;
                    const isTop = position === visible.length - 1;
                    return (
                      <path
                        key={item.key}
                        d={topRoundedRect(x, top, barWidth, bottom - top, isTop ? RADIUS : 0)}
                        fill={item.color}
                      />
                    );
                  })}
                  {/* Hit target: the whole band, taller than the mark. */}
                  <rect
                    x={MARGIN.left + band * index}
                    y={MARGIN.top}
                    width={band}
                    height={plotHeight}
                    fill="transparent"
                  />
                  {index % labelEvery === 0 && (
                    <text
                      x={MARGIN.left + band * index + band / 2}
                      y={MARGIN.top + plotHeight + 16}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[11px] tabular-nums"
                    >
                      {category}
                    </text>
                  )}
                </g>
              );
            })}
            {(totals[peak] ?? 0) > 0 && (
              <text
                x={MARGIN.left + band * peak + band / 2}
                y={y(totals[peak] ?? 0) - 6}
                textAnchor="middle"
                className="fill-foreground text-[11px] font-semibold tabular-nums"
                pointerEvents="none"
              >
                {formatValue(totals[peak] ?? 0)}
              </text>
            )}
          </svg>
        )}
        {active !== null && width > 0 && (
          <div
            role="status"
            className={cn(
              'pointer-events-none absolute top-0 z-10 min-w-36 rounded-md border bg-popover px-3 py-2 text-sm shadow-md',
              activeLeft > width / 2 ? '-translate-x-full' : '',
            )}
            style={{ left: activeLeft > width / 2 ? activeLeft - 12 : activeLeft + 12 }}
          >
            <p className="mb-1 text-xs text-muted-foreground">
              {categoryHeader}: {categories[active]}
            </p>
            {series.map((item) => (
              <p key={item.key} className="flex items-center gap-2">
                <span
                  className="h-0.5 w-3 rounded-full"
                  style={{ backgroundColor: item.color }}
                  aria-hidden
                />
                <span className="font-semibold tabular-nums">
                  {formatValue(item.values[active] ?? 0)}
                </span>
                <span className="text-muted-foreground">{item.label}</span>
              </p>
            ))}
            {series.length > 1 && (
              <p className="mt-1 border-t pt-1">
                <span className="font-semibold tabular-nums">
                  {formatValue(totals[active] ?? 0)}
                </span>{' '}
                <span className="text-muted-foreground">{t('charts.total')}</span>
              </p>
            )}
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          {t('charts.showTable')}
        </summary>
        <Table className="mt-2">
          <TableHeader>
            <TableRow>
              <TableHead>{categoryHeader}</TableHead>
              {series.map((item) => (
                <TableHead key={item.key} className="text-right">
                  {item.label}
                </TableHead>
              ))}
              {series.length > 1 && (
                <TableHead className="text-right">{t('charts.total')}</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((category, index) => (
              <TableRow key={category}>
                <TableCell className="tabular-nums">{category}</TableCell>
                {series.map((item) => (
                  <TableCell key={item.key} className="text-right tabular-nums">
                    {formatValue(item.values[index] ?? 0)}
                  </TableCell>
                ))}
                {series.length > 1 && (
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatValue(totals[index] ?? 0)}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </figure>
  );
}
