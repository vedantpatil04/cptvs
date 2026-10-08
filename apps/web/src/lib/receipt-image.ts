/**
 * Renders a receipt as a PNG using the page's own fonts, so translated labels
 * in Kannada and Devanagari print correctly. All values are passed in already
 * formatted — this module only lays out text.
 */
export interface ReceiptImageRow {
  label: string;
  value: string;
}

export interface ReceiptImageContent {
  brandLines: string[];
  heading: string;
  sections: ReceiptImageRow[][];
  total: ReceiptImageRow;
  notes: string[];
  qrDataUrl: string | null;
  qrCaption: string;
  footer: string;
}

const WIDTH = 640;
const PADDING = 40;
const SCALE = 2;
const FONT_STACK =
  "'Noto Sans Variable', 'Noto Sans Kannada Variable', 'Noto Sans Devanagari Variable', sans-serif";
const INK = '#0f172a';
const MUTED = '#475569';
const RULE = '#cbd5e1';

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

const wrap = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
};

export async function renderReceiptPng(content: ReceiptImageContent): Promise<Blob> {
  await document.fonts.ready;
  const qr = content.qrDataUrl ? await loadImage(content.qrDataUrl) : null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not supported');

  const inner = WIDTH - PADDING * 2;
  const font = (size: number, weight = 400) => `${weight} ${size}px ${FONT_STACK}`;

  /** Lays out the receipt; draws only when `draw` is true. Returns the height. */
  const layout = (draw: boolean): number => {
    let y = PADDING;
    const text = (
      value: string,
      size: number,
      weight: number,
      color: string,
      align: 'left' | 'center' | 'right',
      x: number,
    ) => {
      ctx.font = font(size, weight);
      ctx.fillStyle = color;
      ctx.textAlign = align;
      if (draw) ctx.fillText(value, x, y);
    };
    const rule = () => {
      y += 10;
      if (draw) {
        ctx.strokeStyle = RULE;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(PADDING, y);
        ctx.lineTo(WIDTH - PADDING, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      y += 22;
    };
    const row = ({ label, value }: ReceiptImageRow, size = 16, weight = 400) => {
      ctx.font = font(size, weight);
      const valueWidth = Math.min(ctx.measureText(value).width, inner * 0.6);
      const labelLines = wrap(ctx, label, inner - valueWidth - 16);
      labelLines.forEach((line, index) => {
        text(line, size, weight, index === 0 ? MUTED : MUTED, 'left', PADDING);
        if (index === 0)
          text(value, size, weight === 400 ? 600 : weight, INK, 'right', WIDTH - PADDING);
        y += size + 10;
      });
    };

    y += 8;
    content.brandLines.forEach((line, index) => {
      ctx.font = font(index === 0 ? 30 : 15, index === 0 ? 700 : 500);
      for (const part of wrap(ctx, line, inner)) {
        text(
          part,
          index === 0 ? 30 : 15,
          index === 0 ? 700 : 500,
          index === 0 ? INK : MUTED,
          'center',
          WIDTH / 2,
        );
        y += index === 0 ? 36 : 22;
      }
    });
    rule();
    text(content.heading, 18, 700, INK, 'center', WIDTH / 2);
    y += 30;
    for (const section of content.sections) {
      for (const entry of section) row(entry);
      rule();
    }
    row(content.total, 22, 700);
    rule();
    for (const note of content.notes) {
      ctx.font = font(13, 400);
      for (const line of wrap(ctx, note, inner)) {
        text(line, 13, 400, MUTED, 'center', WIDTH / 2);
        y += 20;
      }
    }
    if (qr) {
      y += 8;
      const size = 180;
      if (draw) ctx.drawImage(qr, (WIDTH - size) / 2, y, size, size);
      y += size + 24;
      text(content.qrCaption, 13, 400, MUTED, 'center', WIDTH / 2);
      y += 28;
    }
    text(content.footer, 15, 600, INK, 'center', WIDTH / 2);
    return y + PADDING;
  };

  ctx.font = font(16);
  const height = layout(false);
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.textBaseline = 'middle';
  layout(true);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Export failed'))),
      'image/png',
    ),
  );
}

export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};
