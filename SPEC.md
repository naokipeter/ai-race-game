# AI Race Game – Digital Version: Specification

Digital adaptation of the tabletop *AI Race Game* by Naoki Peter (CC BY-SA 4.0).
Source of the rules: `../AI Race Game.pdf`, `../table sheet.png`, `../cards.png`.

## 1. Goals

- Keep the **tabletop feel**: one shared screen in the middle of the table, people talk to
  each other, phones are only a "hand of cards".
- One table = 2–5 players (designed for 4–5), one **big screen** (laptop/tablet, landscape)
  and one **phone per player**.
- Several tables can play at the same time, each with its own room.
- No database. One small Node.js process, all state in memory.

## 2. Devices and roles

| Device | URL | Role |
|---|---|---|
| Big screen | `/` → "Host a table" → `/host?room=ABCD` | Instructions, board, reveal, die, ranking. The only place where the game is advanced. |
| Phone | scan QR → `/play?room=ABCD` | Enter name, pick a card each round, see own result. |

## 3. Game flow

### 3.1 Lobby
1. Big screen opens the main page and taps **Host a table**. A room with a 4-letter code is created.
2. Big screen shows a QR code, the join URL and the room code.
3. Each player scans the QR code, enters a name (max. 12 characters) and appears on the big
   screen in a seat (1–5).
4. Seat order = order around the table, **clockwise**. It can be changed on the big screen
   (▲/▼) so that it matches where people really sit. Players can be removed (✕).
5. **Start game** is enabled with 2 or more players. No new players after the start.

### 3.2 Round loop (per Generation, up to 6 rounds)
1. **Banner** – "GENERATION n · Safety starts at s" at the start of a Generation, then
   "ROUND r" at the start of every round.
2. **Discussion + action selection** – big screen shows the discussion prompt from the table
   sheet and one face-down card slot per seat. On the phone each active player swipes
   through the five cards and taps **Lock in**. The phone then shows a card back
   ("Locked in – eyes up!"); the choice can be changed until the reveal.
   EXPOSE cards show the name of the player they currently target.
3. **Reveal** – when every active player is locked in, a large **REVEAL** button appears on
   the big screen. Tapping it flips all cards at the same time.
4. **Action resolution (animated)** – in this order:
   expose hits ("EXPOSED!" stamp on the racer) → capability dots move step by step, with a
   flash and a sound on arrival → released players' dots fly into the saved-points column →
   the Safety marker moves.
5. **Collapse roll** – a 3D d12 appears; tapping it throws it. Result: "SAFE" or
   "COLLAPSE" (screen shake, red flash, unreleased dots fall back to 0).
6. **Next** – button on the big screen continues to the next round, the Generation
   summary, or the final ranking.

### 3.3 End
After Generation 3 the big screen shows the **ranking** (revealed from last to first place,
confetti for the winner) with points per Generation. "Play again" restarts with the same
players.

## 4. Rules as implemented

Constants: 3 Generations; max. 6 rounds each; starting Safety 12 / 11 / 10; Capability 0–12;
Safety 0–12.

**Terms**
- *Released*: has banked points this Generation; out until the next Generation.
- *Skipping*: was exposed in the previous round; sits out exactly one round.
- *Active*: neither released nor skipping. Only active players choose a card.

**Cards**
| Card | Effect |
|---|---|
| COOPERATE | +1 Capability |
| RACE | +2 Capability, −1 Safety |
| RELEASE | Bank the points of the current Capability level, leave the Generation |
| EXPOSE LEFT / RIGHT | Targets the next *active* player in that direction. If the target chose RACE: exposer +2 Capability, target's RACE is worth 1 less and the target skips the next round. Otherwise nothing happens. |

- RACE exposed by one neighbour: +1 Capability. Exposed by both: +0. In both cases the
  racer skips one round. Each successful exposer gets +2.
- Left = next seat clockwise, right = next seat counter-clockwise (players facing the table).

**Points on release** (bands "1P–5P" of the table sheet)

| Capability | 0 | 1–3 | 4–6 | 7–8 | 9–10 | 11–12 |
|---|---|---|---|---|---|---|
| Points | 0 | 1 | 2 | 3 | 4 | 5 |

**Safety** (after the reveal): +1 if a strict majority (> 50 %) of the active players who
are not releasing this round chose COOPERATE or EXPOSE; −1 for each RACE; then clamped to 0–12.

**Collapse roll**: d12; collapse if Safety < roll. On collapse every player who has not
released loses their Capability (0 points for this Generation); the Generation ends.

**Generation end**: collapse, or after round 6 (the remaining players then release
automatically), or when everybody has released. Unlike the printed rules, the Generation does
**not** end when only one player is left: that player plays on alone.

### Decisions on points the rule sheet leaves open

Confirmed by the author:
1. Points are banded (table above), Capability is capped at 12.
2. A single remaining player plays on alone until they release, collapse or round 6 ends
   (changed from the printed rules). Alone, a cooperative card is a majority (1 of 1) and
   raises Safety: a lone developer can take more time for testing. The same applies when two
   players are left and one of them sits out a round.
3. Reveal is triggered by a button on the big screen.
4. An exposed RACE still costs 1 Safety.
5. Skipping players do not count for the majority and cannot be targeted, but they do lose
   their Capability in a collapse.
6. A pending skip does not carry over into the next Generation.
7. The die is rolled every round, also when Safety is 12 (cannot collapse).
8. The interface is in English.

9. RELEASE is not a cooperative action, and players who release in a round no longer count
   for that round's majority (2 × COOPERATE + 1 × RACE + 1 × RELEASE = 2 of 3, majority).
10. If everybody has released, no collapse roll is made.
11. Ties in the final ranking share a rank.

All of these live in `game.js`.

## 5. Big screen UI

Landscape, modelled on the table sheet (white, navy/blue circuit look).

- **Header**: title, Generation chips 1–3 (with starting Safety), Round chips 1–6, room code.
- **Capability tracks**: one row per seat – seat badge, name, card slot, cells 0–12 with the
  1P–5P bands, a coloured dot, saved points G1 G2 G3 and Σ.
- **Safety track**: 0–12 in the sheet's red→green colours with the risk labels and a marker.
  Cells above the current Safety are darkened and carry a pale skull behind the number (the
  rolls that cause a collapse) and a label
  gives the odds ("Collapse on a roll of 10–12 · 3 in 12"). After the roll a die marker lands
  on the rolled number.
- **Stage** (right side): shows what to do now – discussion prompt and "n of m locked in",
  REVEAL button, the d12, result, Next button.
- Not shown permanently: the rule texts of the sheet. A **?** button opens them.
- Sound effects are synthesised in the browser (no audio files); mute button in the header.
- The screen is kept awake (Wake Lock API) where the browser supports it.

## 6. Phone UI

Portrait. States: join form → waiting → card carousel (swipe, scroll-snap) → locked
(card back, "Change card") → result of the round (own card, gain, capability, saved points)
→ "sitting out" / "released" → final rank. Vibrates on lock-in and on results where
supported. Screen kept awake where supported.

## 7. Architecture

- `server.js` – Node.js ≥ 18, **no npm dependencies**. Serves the static files and a small
  JSON API. Live updates via Server-Sent Events (works through school proxies; no WebSocket
  library needed).
- `game.js` – pure rules engine (no I/O), covered by `test/game.test.js` (`node --test`).
- `public/` – plain HTML/CSS/JS, no build step. QR codes are generated in the browser
  (`public/vendor/qrcode.js`, MIT). Fonts are self-hosted (`public/fonts`, SIL OFL), card
  images are cropped from `../cards.png`. Nothing is loaded from other servers.
- The server is authoritative: phones send only "my card"; cards are never sent to the big
  screen before the reveal; the die is rolled on the server.

API
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/create` | create room → `{code, token}` (host token) |
| POST | `/api/join` | `{code, name}` → `{token}` (player token) |
| GET | `/api/events?room&token` | SSE stream of the room state, tailored to the client |
| POST | `/api/action` | `{code, token, type, …}` – host: `start, reveal, roll, next, restart, move, kick, autoplay`; player: `choose, unchoose` |

Robustness
- Tokens are stored in the browser (`localStorage`); reloading a phone or the big screen
  resumes the same seat/room.
- A player whose phone lost its token can rejoin by entering the **same name** while the
  old connection is offline.
- If a phone is gone for good, the big screen can play COOPERATE for that player
  (tap the player's card slot during selection).
- Rooms are deleted after 3 hours without activity. A server restart ends all games
  (accepted consequence of "no database").

## 8. Running

```
node server.js            # http://localhost:3000
PORT=8080 node server.js
```
Local network: phones must reach the laptop's IP (the lobby shows the LAN address
automatically when opened via localhost). Internet: deploy the folder to any Node host
(Render, Fly.io, Railway, …) with start command `node server.js`.

Testing: `node --test` runs the rule tests. `/host?room=ABCD&speed=0.2` speeds up all
big-screen animations.

## 9. Out of scope (for now)

Accounts, persistence, teacher dashboard across tables, timers, phone-face-down reveal,
languages other than English.
