/**
 * ESC/POS receipt printer via Web USB API.
 * Compatible with Xprinter XP-58, Epson TM-T82, and most 58mm/80mm thermal printers.
 * Falls back to window.print() if Web USB unavailable (e.g. Firefox).
 */

// ESC/POS command bytes
const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a
const CUT_PARTIAL = [GS, 0x56, 0x01]
const INIT = [ESC, 0x40]
const ALIGN_LEFT = [ESC, 0x61, 0x00]
const ALIGN_CENTER = [ESC, 0x61, 0x01]
const BOLD_ON = [ESC, 0x45, 0x01]
const BOLD_OFF = [ESC, 0x45, 0x00]
const DOUBLE_HEIGHT_ON = [GS, 0x21, 0x01]
const DOUBLE_HEIGHT_OFF = [GS, 0x21, 0x00]

const VENDOR_IDS = [
  0x0416, // Winbond / Xprinter
  0x04b8, // Epson
  0x1504, // Star Micronics
  0x0519, // Bixolon
  0x067b, // Prolific USB-Serial (common with POS printers)
]

export interface ReceiptItem {
  name: string
  qty: number
  unitPrice: number  // VND
}

export interface ReceiptData {
  outletName: string
  outletAddress?: string
  receiptNo: string
  cashierName: string
  items: ReceiptItem[]
  subtotal: number   // VND
  taxAmount: number  // VND
  total: number      // VND
  paymentMethod: string
  cashReceived?: number
  changeAmount?: number
  note?: string
  printedAt: Date
}

function encode(text: string): Uint8Array {
  // Use TextEncoder for UTF-8; printer must support code page 37 (PC437) or Unicode
  return new TextEncoder().encode(text)
}

function bytes(...args: (number | number[])[]): number[] {
  return args.flat()
}

function divider(width = 32): string {
  return '-'.repeat(width) + '\n'
}

function formatVnd(amount: number): string {
  return amount.toLocaleString('vi-VN') + 'd'
}

function buildReceiptBuffer(data: ReceiptData, width = 32): Uint8Array {
  const parts: (number[] | Uint8Array)[] = []

  const push = (b: number[]) => parts.push(b)
  const text = (s: string) => parts.push(Array.from(encode(s)))
  const nl = () => push([LF])

  push(bytes(INIT))

  // Header
  push(bytes(ALIGN_CENTER, BOLD_ON, DOUBLE_HEIGHT_ON))
  text(data.outletName + '\n')
  push(bytes(DOUBLE_HEIGHT_OFF, BOLD_OFF))
  if (data.outletAddress) text(data.outletAddress + '\n')
  nl()

  push(bytes(ALIGN_LEFT))
  text(divider(width))

  const ts = data.printedAt.toLocaleString('vi-VN', { hour12: false })
  text(`So HD: ${data.receiptNo}\n`)
  text(`Thu ngan: ${data.cashierName}\n`)
  text(`Thoi gian: ${ts}\n`)
  text(divider(width))

  // Items
  for (const item of data.items) {
    const qtyPrice = `${item.qty} x ${formatVnd(item.unitPrice)}`
    const total = formatVnd(item.qty * item.unitPrice)
    const nameLen = width - total.length - 1
    const nameLine = (item.name.length > nameLen ? item.name.substring(0, nameLen - 1) + '.' : item.name)
    text(nameLine.padEnd(nameLen) + ' ' + total + '\n')
    if (item.qty > 1) text(`  ${qtyPrice}\n`)
  }

  text(divider(width))

  // Totals
  const col1 = Math.floor(width / 2)
  const col2 = width - col1
  const row = (label: string, value: string) =>
    text(label.padEnd(col1) + value.padStart(col2) + '\n')

  row('Tong cong:', formatVnd(data.subtotal))
  if (data.taxAmount > 0) row('Thue VAT:', formatVnd(data.taxAmount))

  push(bytes(BOLD_ON, DOUBLE_HEIGHT_ON))
  row('THANH TOAN:', formatVnd(data.total))
  push(bytes(DOUBLE_HEIGHT_OFF, BOLD_OFF))

  row(`Hinh thuc TT:`, data.paymentMethod)
  if (data.cashReceived != null) row('Tien mat:', formatVnd(data.cashReceived))
  if (data.changeAmount != null && data.changeAmount > 0) row('Tien thua:', formatVnd(data.changeAmount))

  text(divider(width))

  push(bytes(ALIGN_CENTER))
  text('Cam on quy khach!\nHen gap lai.\n')
  if (data.note) {
    nl()
    text(data.note + '\n')
  }

  // Feed + cut
  push([LF, LF, LF])
  push(bytes(CUT_PARTIAL))

  // Flatten
  const total_len = parts.reduce((acc, p) => acc + p.length, 0)
  const buf = new Uint8Array(total_len)
  let offset = 0
  for (const p of parts) {
    buf.set(p, offset)
    offset += p.length
  }
  return buf
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyUSBDevice = any

async function requestUsbPrinter(): Promise<AnyUSBDevice> {
  const filters = VENDOR_IDS.map(vendorId => ({ vendorId }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (navigator as any).usb.requestDevice({ filters })
}

async function printViaUsb(data: ReceiptData): Promise<void> {
  const device: AnyUSBDevice = await requestUsbPrinter()
  await device.open()
  try {
    if (device.configuration == null) await device.selectConfiguration(1)
    const iface = device.configuration.interfaces[0]
    await device.claimInterface(iface.interfaceNumber)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ep = iface.alternate.endpoints.find((e: any) => e.direction === 'out')
    if (!ep) throw new Error('No OUT endpoint found on printer')
    const buf = buildReceiptBuffer(data)
    await device.transferOut(ep.endpointNumber, buf)
    await device.releaseInterface(iface.interfaceNumber)
  } finally {
    await device.close()
  }
}

function printViaWindow(data: ReceiptData): void {
  const items = data.items.map(i =>
    `<tr><td>${i.name}</td><td>${i.qty}</td><td>${formatVnd(i.qty * i.unitPrice)}</td></tr>`
  ).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:monospace;width:58mm;margin:0;padding:4px;font-size:11px}
  h2{text-align:center;margin:4px 0;font-size:13px}
  table{width:100%;border-collapse:collapse}
  td{padding:1px 2px}
  .right{text-align:right}
  .bold{font-weight:bold}
  hr{border:none;border-top:1px dashed #000;margin:4px 0}
  .total-row td{font-weight:bold;font-size:13px}
  @media print{button{display:none}}
</style></head><body>
<h2>${data.outletName}</h2>
${data.outletAddress ? `<p style="text-align:center;margin:2px 0">${data.outletAddress}</p>` : ''}
<hr>
<p>So HD: ${data.receiptNo}<br>Thu ngan: ${data.cashierName}<br>
${data.printedAt.toLocaleString('vi-VN', { hour12: false })}</p>
<hr>
<table><thead><tr><th>Mon</th><th>SL</th><th class="right">Tien</th></tr></thead>
<tbody>${items}</tbody></table>
<hr>
<table>
<tr><td>Tong cong</td><td class="right">${formatVnd(data.subtotal)}</td></tr>
${data.taxAmount > 0 ? `<tr><td>Thue VAT</td><td class="right">${formatVnd(data.taxAmount)}</td></tr>` : ''}
<tr class="total-row"><td>THANH TOAN</td><td class="right">${formatVnd(data.total)}</td></tr>
<tr><td>Hinh thuc</td><td class="right">${data.paymentMethod}</td></tr>
${data.cashReceived != null ? `<tr><td>Tien mat</td><td class="right">${formatVnd(data.cashReceived)}</td></tr>` : ''}
${data.changeAmount ? `<tr><td>Tien thua</td><td class="right">${formatVnd(data.changeAmount)}</td></tr>` : ''}
</table>
<hr>
<p style="text-align:center">Cam on quy khach!<br>Hen gap lai.</p>
</body></html>`

  const win = window.open('', '_blank', 'width=300,height=600')
  if (!win) return
  win.document.write(html)
  win.document.close()
  win.onload = () => { win.print(); win.close() }
}

export async function printReceipt(data: ReceiptData): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ('usb' in (navigator as any)) {
    try {
      await printViaUsb(data)
      return
    } catch (err) {
      // User cancelled device picker or printer error → fall through to window.print
      if ((err as Error).name === 'NotFoundError') throw err
      console.warn('USB print failed, falling back to window.print:', err)
    }
  }
  printViaWindow(data)
}
