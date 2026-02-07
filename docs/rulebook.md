# Domination Revival - Rulebook

## Overview

Domination Revival is a daily-turn grand strategy game played via Discord. Players control provinces, build armies, form alliances, and compete for dominance on a massive 700-province map.

**Core Loop:** Players submit orders during the day. At the daily tick time (configurable, default 12:00 PM ET), the server resolves all orders simultaneously - movements, battles, resource generation, building construction, Pope actions, and eliminations.

---

## Map Structure

### Hierarchy
- **Province** (700 total): The smallest unit of control. Each has resource outputs and can hold buildings and armies.
- **Sub-Region** (70 total): Groups of ~10 provinces. Fully controlling a sub-region grants a passive bonus.
- **Region** (10 total): Groups of ~7 sub-regions. Fully controlling a region grants a powerful active ability.

### Adjacency
Provinces are connected via an adjacency graph. Troops can only move to adjacent provinces (unless using the Forced March region ability).

---

## Players & Resources

### Resources
| Resource | Symbol | Uses |
|----------|--------|------|
| **Gold** | G | Building, recruiting, upkeep, mercenaries |
| **Food** | F | Recruiting regulars, upkeep |
| **Faith** | F | Pope abilities (cannot be traded) |

**Starting Resources:** 300 Gold, 300 Food, 0 Faith, 80 Regular Troops

### Province Outputs
When a player captures a province, its resource profile is randomly rolled:
- GoldOutput + FoodOutput + FaithOutput <= 100
- At least one output > 0
- Outputs are re-rolled each time the province changes hands

---

## Army Types

| Unit | Recruit Cost | Upkeep/Turn | Notes |
|------|-------------|-------------|-------|
| **Regular Troops** | 2G + 2F | 1G + 1F | Standard army |
| **Mercenaries** | 6G | 2G | Gold-only, more expensive |

### Upkeep Rules
- Upkeep is deducted each tick (Phase B)
- If you can't pay, units are disbanded: mercenaries first, then regulars
- Barracks buildings reduce regular troop upkeep

---

## Orders

Orders are submitted via Discord slash commands and can be edited until the daily tick.

### Move Order (`/move`)
Move troops from one province to an adjacent province.
- Specify origin, target, and number of troops/mercs to commit
- Units are auto-scaled down if you overcommit

### Build Order (`/build`)
Construct a new building in a province you own.
- Max 3 buildings per province
- One of each type per province

### Upgrade Order (`/upgrade`)
Upgrade an existing building to the next tier.

### Recruit Order (`/recruit`)
Recruit new troops in a province you own. Costs deducted at tick.

---

## Buildings

Each province can have up to 3 buildings, each upgradable to tier 4.

| Building | Effect per Tier (1/2/3/4) | Build Cost |
|----------|---------------------------|------------|
| **Mint** | +5/+10/+15/+20 Gold Output | T1: 120G |
| **Granary** | +5/+10/+15/+20 Food Output | T2: 220G |
| **Shrine** | +5/+10/+15/+20 Faith Output | T3: 360G |
| **Barracks** | -5%/-8%/-10%/-12% Regular Upkeep (global, cap 30%) | T4: 520G |
| **Fortress** | +1/+2/+3/+4 Defender Dice Bonus | |

**Buildings are destroyed when a province is captured.**

---

## Battle System

### When Battles Occur
- Two or more players move into the same province
- A player moves into a province owned by another player (with garrison)

### D6 Batch Combat
1. Units fight in batches of up to 10 vs 10
2. Units are paired 1-to-1
3. Each unit in a pair rolls 1d6 (+modifiers), higher roll kills the opponent
4. Ties re-roll until resolved
5. Dead units are replaced from reserves
6. Continue until one side is eliminated

### Dice Modifiers (capped at 6)
- **Pope's Blessing:** +1 to all rolls
- **Fortress:** +1/+2/+3/+4 for defender (by tier)
- **Crusade (Region Ability):** +2 for attacker, ignores Fortress

### Multi-Way Battles (3+ combatants)
A randomized bracket tournament determines the winner. Survivors carry over between rounds.

---

## Pope System

### Election
- Every 3 turns, a new Pope is elected
- Probability weighted by total Faith Output (minimum weight: 1)
- Pope term lasts 3 turns

### Pope Abilities (1 cast per tick)

| Ability | Cost | Effect |
|---------|------|--------|
| **Blessing** | 120 Faith | Target player gets +1 dice modifier next tick |
| **Excommunication** | 160 Faith | Target cannot send/receive alliance support next tick |
| **Tithe** | 100 Faith | Pope gains 150 Gold immediately |
| **Interdict** | 200 Faith | Target province's buildings cannot be upgraded next tick |

---

## Alliances

### Formation
- Player A invites Player B with `/alliance invite`
- Player B accepts to form the alliance
- Alliance gets a private Discord channel

### Donations (`/send`)
- Transfer Gold and/or Food to alliance members
- Cap: 40% of your current stock per tick
- Faith **cannot** be transferred

### Troop Support (`/support`)
- Send troops to an alliance member
- Logistics cost: 1 Gold per unit
- Cooldown: 2 + floor(distance/4) turns between the same pair
- Distance = shortest path between any owned provinces of sender and receiver

---

## Territory Bonuses

### Sub-Region Control
Own all provinces in a sub-region to gain one random bonus:
- +10% Gold Output
- +10% Food Output
- +10% Faith Output
- -5% Regular Troop Upkeep

Bonus deactivates if you lose any province in the sub-region.

### Region Control
Own all provinces in a region to gain a powerful ability (usable every 3 turns):

| Ability | Effect |
|---------|--------|
| **Forced March** | One move order can teleport up to distance 3 |
| **Levy** | Instantly recruit 50 free militia (upkeep starts next tick) |
| **Treasury Windfall** | Gain 400 Gold |
| **Crusade** | Next battle: +2 attacker dice, ignores Fortress bonus |

---

## Turn Resolution Order

Each daily tick processes these phases in order:

1. **Phase A:** Validate all submitted orders
2. **Phase B:** Deduct army upkeep; disband units if resources insufficient
3. **Phase C:** Generate resources from owned provinces + building bonuses
4. **Phase D:** Process building, recruitment, donation, and support orders
5. **Phase E:** Resolve all movement, battles, and province captures
6. **Phase F:** Calculate territory bonuses (sub-region/region)
7. **Phase G:** Pope election (if applicable) + Pope ability execution
8. **Phase H:** Eliminate players with 0 provinces; clean up alliances

---

## Elimination

- A player is eliminated when they own 0 provinces
- All their armies are disbanded
- Resources set to 0
- Removed from alliances
- They cannot submit further orders

---

## Game Flow

1. **Admin creates game** (`/game create`)
2. **Admin opens joining** (`/game open_join`)
3. **Players join** (`/join`)
4. **Admin starts draft** (`/game begin`)
5. **Snake draft** - Players take turns picking provinces
6. **Game goes ACTIVE** - Daily tick cycle begins
7. **Play until victory** or admin ends game
