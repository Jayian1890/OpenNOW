# GFN Input Protocol — Cursor / Mouse / Keyboard / Gamepad Wire Format

Reverse-engineering reference for the NVIDIA GeForce NOW input protocol,
as implemented in the official GFN browser client (`vendor_beautified.js`)
and reproduced in OpenNOW (`opennow-stable/src/renderer/src/gfn/inputProtocol.ts`).

---

## 1. Overview

All user input (keyboard, mouse, gamepad) is serialized into binary packets
and sent over WebRTC data channels to the GFN streaming server. The server
interprets these packets and injects the corresponding OS-level input events
into the cloud VM running the game.

Each packet begins with a 4-byte **event type** field (little-endian `u32`),
followed by event-specific payload fields. Protocol version 3+ wraps each
packet in an outer timestamp frame (see §14).

---

## 2. Transport Channels

Three WebRTC data channels carry input and cursor state:

| Channel label | Ordered | Reliability | Direction | Used for |
|---|---|---|---|---|
| `input_channel_v1` | Yes | Reliable | Client → Server | Keyboard, mouse buttons, mouse wheel, heartbeat, gamepad (fallback) |
| `input_channel_partially_reliable` | No | `maxPacketLifeTime` (default 300 ms) | Client → Server | Mouse move, gamepad |
| `cursor_channel` | Yes | Reliable | Server → Client | Cursor visibility, cursor image data |

The reliable channel also carries the **protocol version handshake** from the
server (see §13).

The `cursor_channel` is a server-to-client channel that sends cursor state
updates from the cloud VM. See §17 for message format details.

### 2a. Client-Side Capture Modes

The browser/Electron client uses the **Pointer Lock API** (`requestPointerLock`)
to capture mouse input. This differs from native implementations:

| Feature | Native (Rust/winit) | Browser/Electron |
|---|---|---|
| Capture API | `CursorGrabMode::Confined` / `Locked` | Pointer Lock API |
| Windows Raw Input | `RAWINPUTDEVICE` HID registration | Not available |
| macOS Event Taps | `CGEventTapLocation::HIDEventTap` | Not available |
| OS acceleration | Bypassed (hardware deltas) | Applied by OS before browser |
| Latency | 10-30ms | 20-40ms (additional browser event loop) |

**Limitation:** Browser environments cannot access hardware-level raw input.
The Pointer Lock API provides `movementX/Y` which are pre-accelerated by the
OS mouse settings. This is a fundamental web platform limitation that native
addons (node-ffi, N-API) could potentially address in the future.

---

## 3. Mouse Button Down (type 8)

Sent when a mouse button is pressed.

```
Offset  Size   Endian  Field
0x00    4      LE      Event type = 8 (INPUT_MOUSE_BUTTON_DOWN)
0x04    1      —       Button code (1-based, see §15)
0x05    1      —       Padding (0x00)
0x06    4      BE      Reserved (0x00000000)
0x0A    8      BE      Timestamp (µs, see §11)
```

Total: **18 bytes** (raw payload before v3 wrapper).

---

## 4. Mouse Button Up (type 9)

Sent when a mouse button is released. Identical layout to §3.

```
Offset  Size   Endian  Field
0x00    4      LE      Event type = 9 (INPUT_MOUSE_BUTTON_UP)
0x04    1      —       Button code (1-based, see §15)
0x05    1      —       Padding (0x00)
0x06    4      BE      Reserved (0x00000000)
0x0A    8      BE      Timestamp (µs, see §11)
```

Total: **18 bytes**.

---

## 5. Relative Mouse Move (type 7)

Sent for pointer-locked relative mouse movement.

```
Offset  Size   Endian  Field
0x00    4      LE      Event type = 7 (INPUT_MOUSE_REL)
0x04    2      BE      Delta X (i16, signed)
0x06    2      BE      Delta Y (i16, signed)
0x08    2      BE      Reserved (0x0000)
0x0A    4      BE      Reserved (0x00000000)
0x0E    8      BE      Timestamp (µs, see §11)
```

Total: **22 bytes** (raw payload before v3 wrapper).

Mouse move events are sent on the **partially reliable** channel and are
coalesced: multiple browser `pointermove`/`pointerrawupdate` events within
one flush interval (4–16 ms) are summed into a single packet.

### 5a. Pointer Capture Implementation

The client uses `element.setPointerCapture()` and the Pointer Lock API to capture
mouse input during streaming:

```ts
// Pointer capture for mouse button tracking across element boundaries
element.setPointerCapture(event.pointerId);

// Pointer lock for relative movement (no cursor bounds)
element.requestPointerLock({ unadjustedMovement: true });
```

**Event flow:**
1. `pointerrawupdate` (Chrome/Edge) → hardware-timed events, coalesced
2. `pointermove` → standard pointer events with `movementX/Y`
3. `mousemove` → fallback for older browsers

**Coalesced events:** When available, `event.getCoalescedEvents()` returns
all sub-frame movements that were merged into a single event.

---

## 6. Mouse Wheel (type 10)

Sent when the scroll wheel is used.

```
Offset  Size   Endian  Field
0x00    4      LE      Event type = 10 (INPUT_MOUSE_WHEEL)
0x04    2      BE      Horizontal scroll delta (i16, usually 0)
0x06    2      BE      Vertical scroll delta (i16)
0x08    2      BE      Reserved (0x0000)
0x0A    4      BE      Reserved (0x00000000)
0x0E    8      BE      Timestamp (µs, see §11)
```

Total: **22 bytes**. Uses the **single-event** v3 wrapper (same as keyboard/button).

---

## 7. Key Down (type 3)

Sent when a key is pressed.

```
Offset  Size   Endian  Field
0x00    4      LE      Event type = 3 (INPUT_KEY_DOWN)
0x04    2      BE      Virtual key code (Windows VK_* constant)
0x06    2      BE      Modifier flags (see §12)
0x08    2      BE      USB HID scancode
0x0A    8      BE      Timestamp (µs, see §11)
```

Total: **18 bytes**.

---

## 8. Key Up (type 4)

Sent when a key is released. Identical layout to §7.

```
Offset  Size   Endian  Field
0x00    4      LE      Event type = 4 (INPUT_KEY_UP)
0x04    2      BE      Virtual key code (Windows VK_* constant)
0x06    2      BE      Modifier flags (see §12)
0x08    2      BE      USB HID scancode
0x0A    8      BE      Timestamp (µs, see §11)
```

Total: **18 bytes**.

---

## 9. Heartbeat (type 2)

Sent periodically to keep the input channel alive. **Not wrapped** in the
v3 framing — always sent raw regardless of protocol version.

```
Offset  Size   Endian  Field
0x00    4      LE      Event type = 2 (INPUT_HEARTBEAT)
```

Total: **4 bytes**. Official client function: `Jc()`.

---

## 10. Gamepad (type 12)

Sent at 60 Hz per connected controller. XInput-format payload.

```
Offset  Size   Endian  Field
0x00    4      LE      Event type = 12 (INPUT_GAMEPAD)
0x04    2      LE      Payload size = 26
0x06    2      LE      Gamepad index (0–3)
0x08    2      LE      Bitmap (connected bitmask, see below)
0x0A    2      LE      Inner payload size = 20
0x0C    2      LE      Button flags (XInput XINPUT_GAMEPAD_* bitmask)
0x0E    2      LE      Packed triggers (low byte = LT, high byte = RT, 0–255 each)
0x10    2      LE      Left stick X (i16, −32768 to 32767)
0x12    2      LE      Left stick Y (i16, −32768 to 32767)
0x14    2      LE      Right stick X (i16, −32768 to 32767)
0x16    2      LE      Right stick Y (i16, −32768 to 32767)
0x18    2      LE      Reserved (0x0000)
0x1A    2      LE      Magic constant = 85 (0x0055)
0x1C    2      LE      Reserved (0x0000)
0x1E    8      LE      Timestamp (µs)
```

Total: **38 bytes** (raw payload). Official client function: `gl()`.

**Bitmap field** (offset 0x08): not a simple connected flag. Bit *i* indicates
gamepad *i* is connected; bit *(i+8)* carries additional state. Passed as the
`ae` parameter in `gl()` from the gamepad manager's `this.nu` field.

**Note:** Unlike all other event types, the gamepad payload uses **little-endian
throughout** (including the timestamp). All other events use LE only for the
event type field and BE for the remaining fields.

---

## 11. Timestamp Encoding

### Web / Electron client (browser environment)

All events (except heartbeat) carry a timestamp in microseconds derived from
`performance.now() * 1000`. The official GFN browser client's `_r()` function
computes this value, and OpenNOW matches it exactly:

```ts
function writeTimestamp(view: DataView, offset: number): void {
  const tsUs = performance.now() * 1000;
  const lo = Math.floor(tsUs) & 0xFFFFFFFF;
  const hi = Math.floor(tsUs / 4294967296);
  view.setUint32(offset, hi, false);      // high 32 bits, big-endian
  view.setUint32(offset + 4, lo, false);  // low 32 bits, big-endian
}
```

`performance.now()` is a monotonic clock that starts near zero when the page
loads. Browsers intentionally add a small random offset to prevent timing-based
fingerprinting, so the value does **not** correlate to wall-clock Unix time.

For inner event payload timestamps (keyboard, mouse buttons, gamepad) a `BigInt`
variant is used:

```ts
function timestampUs(sourceTimestampMs?: number): bigint {
  const base =
    typeof sourceTimestampMs === "number" ? sourceTimestampMs : performance.now();
  return BigInt(Math.floor(base * 1000));
}
```

### Native / Rust client (for reference)

Native clients use a session-relative Unix epoch value: session start time
(in Unix microseconds) plus the elapsed monotonic duration:

```rust
pub fn get_timestamp_us() -> u64 {
    if let Some(ref t) = *SESSION_TIMING.read() {
        let elapsed_us = t.start.elapsed().as_micros() as u64;
        t.unix_us.wrapping_add(elapsed_us)
    } else {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_micros() as u64)
            .unwrap_or(0)
    }
}
```

### Comparison

| Client type | Timestamp source | Example value after 5s |
|---|---|---|
| Web / Electron | `performance.now() * 1000` | `~5_000_000 µs` |
| Native / Rust | Unix epoch µs + session elapsed | `~1_710_000_005_000_000 µs` |

These values are numerically very different, but the GFN server accepts both
because it uses timestamps for **relative** ordering, coalescing interval checks
(`MOUSE_FLUSH_FAST_MS = 4 ms`), and stale-packet detection on the partially
reliable channel — not for absolute clock comparison between client and server.

### Byte encoding

The timestamp field is always 8 bytes (u64):

- **Big-endian** for keyboard, mouse move, mouse button, mouse wheel events
- **Little-endian** for gamepad events (see §10)
- **Big-endian** in the v3+ outer wrapper (`0x23` frame), written as two 32-bit
  halves (high word first) by `yc()`

---

## 12. Modifier Flags

Keyboard events carry a 16-bit modifier bitmask at offset 0x06:

| Bit | Mask | Modifier |
|---|---|---|
| 0 | `0x01` | Shift |
| 1 | `0x02` | Ctrl |
| 2 | `0x04` | Alt |
| 3 | `0x08` | Meta (Win/Cmd) |
| 4 | `0x10` | Caps Lock |
| 5 | `0x20` | Num Lock |

---

## 13. Protocol Version Handshake

On the reliable input channel, the server sends a handshake message indicating
the protocol version. Two formats are observed:

**Format A:** `firstWord` (LE u16 at offset 0) equals 526 (`0x020E`):
- Version is at offset 2 as LE u16.
- If message is shorter than 4 bytes, version defaults to 2.

**Format B:** `byte[0]` equals `0x0E`:
- Version is `firstWord` (LE u16 at offset 0).

The client does **not** echo the handshake back (the official browser client
simply reads the version and begins sending input). After handshake, input
encoding switches to the negotiated version.

---

## 14. Protocol v3+ Wrapper

For protocol version 3+, all events are framed with an outer timestamp header
prepended by `yc()` in the official client, plus an inner event marker.

Protocol v1-v2 sends raw payloads unchanged.

### 14a. Single events (keyboard, mouse button, wheel)

Wrapper added by `yc()` + `Ec()` allocator:

```
[0]     0x23            — outer timestamp marker (yc())
[1-8]   Timestamp: u64 (8 bytes, Big Endian, performance.now() * 1000 µs)
[9]     0x22            — single-event sub-message marker (Ec())
[10...] Raw event payload
```

### 14b. Mouse move events

Wrapper added by `yc()` + `Tc()` coalescer:

```
[0]     0x23            — outer timestamp marker (yc())
[1-8]   Timestamp: u64 (8 bytes, Big Endian, performance.now() * 1000 µs)
[9]     0x21            — batched/mouse event marker (Tc())
[10-11] Length: u16 (Big Endian) — payload byte length (Wa())
[12...] Raw mouse move payload (22 bytes)
```

### 14c. Gamepad events — reliable channel

Wrapper added by `yc()` + `ul()` (m=false path):

```
[0]     0x23            — outer timestamp marker (yc())
[1-8]   Timestamp: u64 (8 bytes, Big Endian)
[9]     0x21            — batched event marker (ul())
[10-11] Size: u16 (Big Endian) — payload byte length (Wa())
[12...] Raw gamepad payload (38 bytes)
```

### 14d. Gamepad events — partially reliable channel

Wrapper added by `yc()` + `ul()` (gamepad index path) + `Va(38)` sequence header:

```
[0]     0x23            — outer timestamp marker (yc())
[1-8]   Timestamp: u64 (8 bytes, Big Endian)
[9]     0x26            — PR sequence header byte (decimal 38, Va(38))
[10]    Gamepad index: u8
[11-12] Sequence number: u16 (Big Endian, wraps at 65536)
[13]    0x21            — batched event marker
[14-15] Size: u16 (Big Endian) — payload byte length
[16...] Raw gamepad payload (38 bytes)
```

### Summary table

| Event type | Inner marker | Length field | PR header |
|---|---|---|---|
| Keyboard / Mouse button / Wheel | `0x22` | No | No |
| Mouse move | `0x21` | Yes (BE u16) | No |
| Gamepad (reliable) | `0x21` | Yes (BE u16) | No |
| Gamepad (partially reliable) | `0x21` | Yes (BE u16) | Yes (`0x26` + idx + seq) |

---

## 15. Mouse Button Constants

GFN uses 1-based button codes (offset from browser's 0-based numbering):

| GFN code | Browser `button` | Button |
|---|---|---|
| 1 | 0 | Left |
| 2 | 1 | Middle |
| 3 | 2 | Right |
| 4 | 3 | Back (X1) |
| 5 | 4 | Forward (X2) |

Conversion: `gfnButton = browserButton + 1`.

---

## 16. Event Type Summary

| Type ID | Constant | Event |
|---|---|---|
| 2 | `INPUT_HEARTBEAT` | Heartbeat (keep-alive) |
| 3 | `INPUT_KEY_DOWN` | Key press |
| 4 | `INPUT_KEY_UP` | Key release |
| 7 | `INPUT_MOUSE_REL` | Relative mouse move |
| 8 | `INPUT_MOUSE_BUTTON_DOWN` | Mouse button press |
| 9 | `INPUT_MOUSE_BUTTON_UP` | Mouse button release |
| 10 | `INPUT_MOUSE_WHEEL` | Mouse wheel scroll |
| 12 | `INPUT_GAMEPAD` | Gamepad state |

---

## 18. Local Cursor State

The client maintains local cursor position for rendering the cursor overlay
during pointer lock (since the system cursor is hidden).

```typescript
interface LocalCursor {
  x: number;              // 0 to streamWidth-1
  y: number;              // 0 to streamHeight-1
  visible: boolean;
  imageDataUrl: string | null;
  hotspotX: number;
  hotspotY: number;
  streamWidth: number;
  streamHeight: number;
}
```

**Update logic:**
- Position updates on every mouse move event (relative deltas applied)
- Bounds clamping to stream dimensions
- Triggers `drawCursorOverlay()` to render on canvas

This provides instant visual feedback while waiting for the server's
cursor image updates via `cursor_channel` (§17).

---

## 19. Mouse Coalescing

The client implements mouse movement coalescing to match GFN server
expectations (250 Hz effective rate).

```typescript
interface MouseCoalescer {
  accumulatedDx: number;
  accumulatedDy: number;
  lastSendUs: number;
  coalesceIntervalUs: number;  // 4000 µs = 4ms
}
```

**Accumulation:**
- Browser events add to `accumulatedDx/Dy`
- Flush timer (4ms interval) sends accumulated deltas
- Resets accumulators after each send

**Flush triggers:**
1. Timer expiry (4ms interval)
2. Before button events (to preserve event ordering)
3. Pointer lock loss

**Event ordering requirement:**
Movement is flushed BEFORE button events to ensure correct click positioning:
```
MouseMove(100,200) → MouseButtonDown → MouseMove(50,50)
```

---

## 17. Cursor Channel Messages (Server → Client)

The `cursor_channel` carries cursor state updates from the GFN server to
the client. Unlike input channels which carry client input to the server,
this channel streams cursor images and visibility changes from the cloud
VM back to the client for local rendering.

### 17a. Message Format

Messages are variable-length binary payloads:

```
[0]       Visibility flag: u8 (0 = hidden, non-zero = visible)
[1-2]     Hotspot X: u16 (Little Endian) — horizontal offset from top-left
[3-4]     Hotspot Y: u16 (Little Endian) — vertical offset from top-left
[5...N]   PNG image data (when visible)
```

**Visibility flag:**
- `0x00` — Cursor is hidden; client should hide the local cursor overlay
- Any non-zero value — Cursor is visible; image data follows

**Minimal message (visibility only):**
When the message is 1 byte (`[0] = 0x01`), the server is indicating cursor
visibility without providing image data. The client should show the default
system cursor or retain the last image.

**Full cursor update:**
When the message is 5+ bytes (`[0] ≠ 0`), the payload includes:
- Hotspot coordinates (where the click point is within the cursor image)
- PNG-encoded cursor image following the hotspot fields

### 17b. PNG Image Validation

The client validates PNG magic bytes at the start of the image data:

```
0x89 0x50 0x4E 0x47 ... (standard PNG header)
```

Invalid formats are logged and ignored; the previous cursor image is retained.

### 17c. Client Rendering

Upon receiving a valid cursor update:

1. Decode the PNG to an `ImageBitmap` (or `<img>` element)
2. Update the local cursor state with dimensions and hotspot
3. Call `onCursorVisibilityChange(true)` to notify the UI
4. Draw the cursor at the locally-tracked position (see §18)

When visibility flag is 0:

1. Set cursor state to `visible: false`
2. Call `onCursorVisibilityChange(false)`
3. Clear the cursor overlay canvas

### 17d. Channel Properties

| Property | Value |
|---|---|
| Label | `cursor_channel` |
| Ordered | Yes |
| Reliable | Yes (no `maxPacketLifeTime`) |
| Binary type | `arraybuffer` |
| Direction | Server → Client only |

The channel is created during WebRTC peer connection setup alongside the
input channels:

```ts
this.cursorChannel = pc.createDataChannel("cursor_channel");
this.cursorChannel.binaryType = "arraybuffer";
this.cursorChannel.onmessage = (msg) => {
  this.onCursorChannelMessage(msg.data);
};
```
