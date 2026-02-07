# Domination Revival - Discord Commands

## Admin Commands

All admin commands require Administrator permissions.

### `/game create`
Create a new game in the current server.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `name` | Yes | - | Game name |
| `map` | No | `default` | Map ID |
| `tick_time` | No | `12:00` | Daily tick time (HH:MM) |
| `tick_tz` | No | `America/New_York` | Timezone for tick |
| `starting_provinces` | No | `3` | Provinces per player in draft (1-5) |

Creates game channels: #announcements, #lobby, #map

### `/game open_join`
Open the game for players to join.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `hours` | No | `24` | Join duration in hours (1-168) |

### `/game begin`
End the join phase and start the snake draft. Requires 2+ players.

### `/game end`
End the current game immediately.

### `/game status`
Show current game status, player count, turn number, Pope info.

---

## Player Commands

### `/join`
Join the current game (during JOINING phase). Creates your private orders channel.

### `/leave`
Leave the current game (only during JOINING phase).

### `/pick`
Pick a province during the draft phase.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `province_id` | Yes | Province ID (e.g., `P0001`) |

### `/my`
View your resources, troop totals, outputs per turn, Pope status, and bonuses.

### `/holdings`
View all your provinces with details (outputs, buildings, armies).

### `/map`
Inspect a province's information.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `province_id` | Yes | Province ID to inspect |

---

## Order Commands

### `/move`
Order troops to move to an adjacent province.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `from` | Yes | Origin province ID |
| `to` | Yes | Target province ID (must be adjacent) |
| `troops` | Yes | Regular troops to move |
| `mercs` | No | Mercenaries to move (default: 0) |

### `/build`
Build a new building in a province you own.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `province` | Yes | Province ID |
| `type` | Yes | Building type: Mint, Granary, Shrine, Barracks, Fortress |

### `/upgrade`
Upgrade an existing building to the next tier.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `province` | Yes | Province ID |
| `type` | Yes | Building type to upgrade |

### `/recruit`
Recruit troops in a province you own.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `province` | Yes | Province ID |
| `regulars` | No | Regular troops to recruit (default: 0) |
| `mercs` | No | Mercenaries to recruit (default: 0) |

### `/orders`
View all your pending orders for the current turn.

### `/cancel`
Cancel a pending order.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `order_id` | Yes | Order ID prefix (from `/orders` output) |

---

## Alliance Commands

### `/alliance invite`
Invite a player to your alliance (creates one if you don't have one).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `player` | Yes | Discord user to invite |

### `/alliance accept`
Accept an alliance invitation.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `alliance_id` | Yes | Alliance ID from the invitation |

### `/alliance rename`
Rename your alliance (creator only).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | New alliance name |

### `/alliance info`
View your alliance members and details.

### `/send`
Send gold or food to an alliance member.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ally` | Yes | Alliance member to send to |
| `gold` | No | Gold amount (default: 0) |
| `food` | No | Food amount (default: 0) |

**Caps:** Max 40% of your current Gold/Food per tick. Faith cannot be sent.

### `/support`
Send troops to an alliance member.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ally` | Yes | Alliance member to support |
| `troops` | No | Regular troops (default: 0) |
| `mercs` | No | Mercenaries (default: 0) |
| `to_province` | No | Target province for arrival |

**Cost:** 1 Gold per unit. **Cooldown:** 2 + floor(distance/4) turns.

---

## Pope Commands

### `/pope cast`
Cast a Pope ability (Pope only, 1 per tick).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ability` | Yes | Blessing, Excommunication, Tithe, or Interdict |
| `target_player` | Conditional | Required for Blessing/Excommunication |
| `target_province` | Conditional | Required for Interdict |

### `/pope info`
View current Pope status and ability costs.
