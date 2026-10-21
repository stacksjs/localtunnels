// The app icon, as instructions rather than as a binary.
//
// `assets/app-icon.png` is committed, because a build should not need Xcode
// to produce an icon and a reviewer should not need it to see one. This is
// what produced that file, and editing the icon means editing this and
// running it again:
//
//     swift scripts/app-icon.swift
//
// Drawn rather than exported from a design tool for the same reason: a
// gradient and a shield are a dozen numbers, and numbers in a file somebody
// can read beat a 1024-pixel square nobody can change.
//
// ── Why a shield ───────────────────────────────────────────────────────
//
// The connect button used to be one and is now play and stop, which say
// what a tap does. That left the shield free for the place a picture of
// what the app is *for* belongs: the home screen, where it sits beside
// thirty other apps and has one job, to be recognised.
//
// No alpha channel is needed here — the background is painted edge to edge.
// App Store Connect refuses an icon with transparency, and Craft flattens
// one anyway, so this avoids the flattening rather than relying on it.

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let side = 1024.0

/// sRGB from the same palette the screens use, so the icon and the button
/// it opens are the same blue rather than two blues.
func rgb(_ hex: UInt32) -> CGColor {
    CGColor(
        red: Double((hex >> 16) & 0xFF) / 255,
        green: Double((hex >> 8) & 0xFF) / 255,
        blue: Double(hex & 0xFF) / 255,
        alpha: 1,
    )
}

let space = CGColorSpaceCreateDeviceRGB()
guard let context = CGContext(
    data: nil,
    width: Int(side),
    height: Int(side),
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: space,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue,
) else { fatalError("could not open a 1024-point canvas") }

/*
 * The background, lighter at the top.
 *
 * A flat fill is the safe choice and reads as a placeholder at icon size;
 * a gradient this shallow is not decoration, it is what keeps a solid
 * square from looking unfinished. `blue-500` to `blue-700`, with the
 * screens' `blue-600` in the middle of it.
 */
let gradient = CGGradient(
    colorsSpace: space,
    colors: [rgb(0x3B82F6), rgb(0x1D4ED8)] as CFArray,
    locations: [0, 1],
)!
context.drawLinearGradient(
    gradient,
    start: CGPoint(x: 0, y: side),
    end: CGPoint(x: 0, y: 0),
    options: [],
)

/*
 * The shield.
 *
 * Square shoulders with rounded corners down to a point, which is the
 * shape a shield reads as at 40 points across — the size this is actually
 * looked at. Inset well clear of the edges: iOS rounds the corners off the
 * square itself, and a mark that runs close to them loses its own.
 */
let left = 300.0
let right = side - left
let top = 252.0
let bottom = side - 212.0
let middle = side / 2
let corner = 72.0
// Where the sides stop being vertical. Higher makes a badge, lower makes a
// spade; a little past half is a shield.
let shoulder = top + (bottom - top) * 0.46

let shield = CGMutablePath()
shield.move(to: CGPoint(x: left, y: top + corner))
shield.addQuadCurve(to: CGPoint(x: left + corner, y: top), control: CGPoint(x: left, y: top))
shield.addLine(to: CGPoint(x: right - corner, y: top))
shield.addQuadCurve(to: CGPoint(x: right, y: top + corner), control: CGPoint(x: right, y: top))
shield.addLine(to: CGPoint(x: right, y: shoulder))
shield.addCurve(
    to: CGPoint(x: middle, y: bottom),
    control1: CGPoint(x: right, y: shoulder + (bottom - shoulder) * 0.44),
    control2: CGPoint(x: middle + (right - middle) * 0.30, y: bottom),
)
shield.addCurve(
    to: CGPoint(x: left, y: shoulder),
    control1: CGPoint(x: middle - (right - middle) * 0.30, y: bottom),
    control2: CGPoint(x: left, y: shoulder + (bottom - shoulder) * 0.44),
)
shield.closeSubpath()

// CoreGraphics counts up from the bottom and the numbers above read down
// from the top, which is how the shape is easier to reason about.
context.saveGState()
context.translateBy(x: 0, y: side)
context.scaleBy(x: 1, y: -1)
context.addPath(shield)
context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
context.fillPath()
context.restoreGState()

guard let image = context.makeImage() else { fatalError("nothing was drawn") }

let here = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
let target = here.deletingLastPathComponent().appendingPathComponent("assets/app-icon.png")
try? FileManager.default.createDirectory(
    at: target.deletingLastPathComponent(),
    withIntermediateDirectories: true,
)
guard let destination = CGImageDestinationCreateWithURL(
    target as CFURL,
    UTType.png.identifier as CFString,
    1,
    nil,
) else { fatalError("could not write \(target.path)") }
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("could not finish \(target.path)") }
print("wrote \(target.path)")
