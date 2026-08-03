import AppKit

struct Panel {
  let title: String
  let path: String
}

let root = FileManager.default.currentDirectoryPath
let panels = [
  Panel(title: "Locked reference: all three canonical states", path: "docs/images/conversational-gtm-prototype.png"),
  Panel(title: "Implementation: progress", path: "docs/qa/expo-progress-390x844.png"),
  Panel(title: "Implementation: assessment", path: "docs/qa/expo-assessment-390x844.png"),
  Panel(title: "Implementation: evidence", path: "docs/qa/expo-evidence-390x844.png"),
]

let canvasSize = NSSize(width: 1700, height: 2080)
let image = NSImage(size: canvasSize)
image.lockFocus()
NSColor(calibratedWhite: 0.96, alpha: 1).setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: canvasSize)).fill()

let titleAttributes: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 26, weight: .semibold),
  .foregroundColor: NSColor(calibratedRed: 0.04, green: 0.09, blue: 0.2, alpha: 1),
]

func drawPanel(_ panel: Panel, in rect: NSRect) {
  let titleRect = NSRect(x: rect.minX, y: rect.maxY - 42, width: rect.width, height: 36)
  (panel.title as NSString).draw(in: titleRect, withAttributes: titleAttributes)
  let imageRect = NSRect(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height - 52)
  guard let source = NSImage(contentsOfFile: root + "/" + panel.path) else {
    fatalError("Unable to open \(panel.path)")
  }
  source.draw(in: imageRect, from: NSRect(origin: .zero, size: source.size), operation: .copy, fraction: 1)
}

drawPanel(panels[0], in: NSRect(x: 82, y: 990, width: 1536, height: 1024))
let implementationWidth: CGFloat = 423
let implementationHeight: CGFloat = 916
let gap: CGFloat = 92
let totalWidth = implementationWidth * 3 + gap * 2
let startX = (canvasSize.width - totalWidth) / 2
for (index, panel) in panels.dropFirst().enumerated() {
  drawPanel(panel, in: NSRect(
    x: startX + CGFloat(index) * (implementationWidth + gap),
    y: 28,
    width: implementationWidth,
    height: implementationHeight,
  ))
}

image.unlockFocus()
guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
  fatalError("Unable to encode comparison image")
}
try png.write(to: URL(fileURLWithPath: root + "/docs/qa/all-states-comparison.png"))
