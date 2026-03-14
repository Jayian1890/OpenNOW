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

Two WebRTC data channels carry input:

| Channel label | Ordered | Reliability | Used for |
|---|---|---|---|
| `input_channel_v1` | Yes | Reliable | Keyboard, mouse buttons, mouse wheel, heartbeat, gamepad (fallback) |
| `input_channel_partially_reliable` | No | `maxPacketLifeTime` (default 300 ms) | Mouse move, gamepad |

The reliable channel also carries the **protocol version handshake** from the
server (see §13).

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
