import AppKit

struct Capture {
  let title: String
  let path: String
}

let root = FileManager.default.currentDirectoryPath
let states = ["Progress", "Assessment", "Evidence"]
let android = [
  Capture(title: "Android", path: "docs/qa/native-android/gtm-progress.png"),
  Capture(title: "Android", path: "docs/qa/native-android/gtm-assessment.png"),
  Capture(title: "Android", path: "docs/qa/native-android/gtm-evidence.png"),
]
let ios = [
  Capture(title: "iOS", path: "docs/qa/native-ios/gtm-progress-ios.png"),
  Capture(title: "iOS", path: "docs/qa/native-ios/gtm-assessment-ios.png"),
  Capture(title: "iOS", path: "docs/qa/native-ios/gtm-evidence-ios.png"),
]

let targetSize = NSSize(width: 403, height: 900)
let labelHeight: CGFloat = 34
let columnGap: CGFloat = 42
let rowGap: CGFloat = 48
let margin: CGFloat = 54
let canvasSize = NSSize(
  width: margin * 2 + targetSize.width * 3 + columnGap * 2,
  height: margin * 2 + (targetSize.height + labelHeight) * 3 + rowGap * 2
)
let canvas = NSImage(size: canvasSize)
let labelAttributes: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 21, weight: .semibold),
  .foregroundColor: NSColor(calibratedRed: 0.04, green: 0.09, blue: 0.2, alpha: 1),
]

func drawImage(_ image: NSImage, source: NSRect, destination: NSRect) {
  NSColor.white.setFill()
  NSBezierPath(roundedRect: destination, xRadius: 18, yRadius: 18).fill()
  image.draw(in: destination, from: source, operation: .copy, fraction: 1)
}

func fullSource(_ image: NSImage) -> NSRect {
  NSRect(origin: .zero, size: image.size)
}

canvas.lockFocus()
NSColor(calibratedWhite: 0.95, alpha: 1).setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: canvasSize)).fill()

guard let reference = NSImage(contentsOfFile: root + "/docs/images/conversational-gtm-prototype.png") else {
  fatalError("Unable to open locked reference")
}
let referenceCrops = [
  NSRect(x: 64, y: 76, width: 403, height: 900),
  NSRect(x: 560, y: 76, width: 403, height: 900),
  NSRect(x: 1055, y: 76, width: 403, height: 900),
]
let rows: [(String, [Capture]?)] = [
  ("Locked reference", nil),
  ("Android native", android),
  ("iOS native", ios),
]

for row in 0..<rows.count {
  let rowY = canvasSize.height - margin - CGFloat(row + 1) * (targetSize.height + labelHeight) - CGFloat(row) * rowGap
  for column in 0..<states.count {
    let x = margin + CGFloat(column) * (targetSize.width + columnGap)
    let label = "\(rows[row].0) · \(states[column])"
    (label as NSString).draw(
      in: NSRect(x: x, y: rowY + targetSize.height + 3, width: targetSize.width, height: labelHeight),
      withAttributes: labelAttributes
    )
    let destination = NSRect(x: x, y: rowY, width: targetSize.width, height: targetSize.height)
    if let captures = rows[row].1 {
      guard let source = NSImage(contentsOfFile: root + "/" + captures[column].path) else {
        fatalError("Unable to open \(captures[column].path)")
      }
      drawImage(source, source: fullSource(source), destination: destination)
    } else {
      drawImage(reference, source: referenceCrops[column], destination: destination)
    }
  }
}

canvas.unlockFocus()
guard let tiff = canvas.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
  fatalError("Unable to encode native comparison")
}
try png.write(to: URL(fileURLWithPath: root + "/docs/qa/native-cross-platform-comparison.png"))
