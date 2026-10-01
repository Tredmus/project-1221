# Project 1221 — Game Design Document

Working title. Living document: **Settled** means agreed in discussion; **Proposed** means drafted but not yet approved; **Open** means not decided. Ideas we parked live in [future-ideas.md](future-ideas.md).

Last updated: 1 October 2026 (game date: 1 October 1226).

---

## 1. Vision

A persistent browser and mobile MMO set in Europe and the Near East in 1226. You start as a nobody, and you get stronger in two ways:

- **Your hero**: attributes, gear, companions, skills, professions. This works completely alone and is the daily hook (about 60% of the game).
- **Your place among people**: clans, elections, offices, wars, reputation. This is the long-term and social layer (about 40%).

The layers feed each other, but **hero power never buys political power**. Offices are won by votes or by force of arms, never by stat totals.

### Pillars
1. **Fun alone, better together.** Every system works with zero other players online. NPCs fill every office, army and market until players replace them.
2. **Visible, colorful progress.** Gear rarity, numbers going up, loot reveals, heraldry. This is one of the biggest factors.
3. **Grounded in history.** Realistic 1220s, with "magic" only through relics people believed in.
4. **Consumption drives everything.** Food is eaten, arrows run out, weapons break. Power has to be kept up, so it can't pile up forever.
5. **Persistence, no resets.** Your character lives in one continuous world. We never wipe it.

### Guardrails (from the research brief)
- No pay-to-win: never sell votes, office, combat strength or market-moving resources.
- Soft caps and diminishing returns on combat stats.
- A newcomer can vote, join a clan and trade within days (after anti-multi-account gates).
- Never print money: every source of supply needs a matching sink.
- Multi-account defenses from day one: account age and activity gates for voting and office, transfer caps between linked accounts, legal sitters.
- Vacation mode from day one. Nothing punishes absence.
- No walls of text. The first meaningful action happens in under a minute.

---

## 2. Setting and time — Settled

- **Start date: 1226.** The game calendar mirrors the real one minus 800 years: 1 Oct 2026 is 1 Oct 1226, and 2027 is 1227.
- **One continuous era.** No historical chapters, no content packs per period, **no resets ever**.
- The world starts as historical 1226 and **drifts as players change it**. History is the starting point, not a script.
- **Historical pressures** are fired by a world director when it fits, not on calendar dates: Mongol raids (the 1223 Kalka-style raid, later the great invasion), crusade and jihad calls, famines, plague, papal interdicts, Cuman migrations. The director favors targeting the strongest realms.

---

## 3. World map — Settled unless marked

### 3.1 Hierarchy
| Tier | Made of | Controlled by |
|---|---|---|
| Node | A point on the map | Nobody (except county main nodes) |
| County | A few nodes, one of them the **main node** | Whoever controls the main node |
| Duchy | 2–3 counties, one of them the **main county** | Open (see 7) |
| Kingdom | 1+ duchies | Open |
| Empire | Kingdoms | Open (e.g. the Bulgarian Tsardom, the Latin Empire, Nicaea, the Holy Roman Empire) |

- **Main node types:** town, castle, mine, farm, monastery (more later). Each type gives different benefits (market and taxes, defense and recruits, ore and gems, food, piety and healing).
- **Other nodes** (roads, crossroads, fords, passes, forests) are only for travel, PvE and events for now. Nobody controls them. Special non-main nodes (ruins, shrines, bandit lairs) come later.
- Each node has a **biome** that decides its mobs and resources (wolves in forests, bandits on roads, raiders on the steppe, ore in hills).
- **Open:** does taking a duchy's main county transfer its other counties?
- Tier names are localized per culture in the interface (boyar lands, themes, duchies), but the code uses one generic hierarchy.

### 3.2 Extent at launch
The **whole map ships at launch**: all of Europe, Anatolia (Nicaea, the Seljuks of Rûm, Cilician Armenia), the crusader states and the Ayyubids. We never add regions later, so nobody waits for "their" country.

Estimated size: 40+ realms, 150+ duchies, 400+ counties, 1,500+ nodes. The Balkans get finished and playtested first.

To fight thin player density: **suggested homelands** at sign-up that point new players to the busy regions, easy migration, and NPC realms that actually behave like realms (elections, wars, diplomacy).

### 3.3 Travel — Settled
- Real-time travel along roads: about 3 h per road on foot, about 2 h mounted. Mountains and off-road travel are slower.
- You can queue a multi-node route.
- Armies move at about half speed (wagons), so defenders get roughly a day's warning.
- Road events (bandits, merchants, pilgrims) make travel content.
- Fighting and gathering happen at your current node, so grinding needs no travel.

### 3.4 Cultures — Settled concept, draft list
Your **country of birth sets your culture**. Each culture has signature recipes that others can only learn **from a master of that culture**: a player teacher, or an NPC master in that culture's towns after an apprenticeship.

| Culture | Realms (examples) | Signature (draft) |
|---|---|---|
| Iberian | Castile, León, Portugal, Aragon, Navarre | Toledo steel |
| Frankish | France, the Latin Empire, Achaea, the crusader states | Couched-lance cavalry gear |
| Greek | Nicaea, Epirus, Trebizond | Klibanion lamellar, Greek fire (later) |
| South Slavic | Bulgaria, Serbia | ? |
| Hungarian | Hungary | ? |
| Italian | Venice, Genoa, the Papal States, Sicily | Crossbows |
| German | the Holy Roman Empire | ? |
| Anglo-Norman | England | ? |
| Steppe | the Cumans | Composite bows, horse gear |
| Turkic-Persian | the Seljuks of Rûm | ? |
| Arab | the Ayyubids | Damascus steel |
| Armenian | Cilicia | ? |
| Others | Poland, Rus', Scandinavia, the Baltic… | ? |

**Open:** the final culture list, signature recipes, and whether culture gives any non-crafting bonuses.

### 3.5 Religion — Settled as a system, details open
| Faith | Leading seat | Notes |
|---|---|---|
| Catholic | The Pope, Rome | Crusade calls, excommunication, interdicts |
| Orthodox | Patriarch in exile at Nicaea; Tarnovo, Ohrid | Bulgarian patriarchate restored 1235 |
| Sunni Islam | The Caliph in Baghdad (nominal) | The Ayyubids and Seljuks hold the real power |
| Nizari Ismaili | Alamut / Masyaf | The Assassins (NPC faction) |
| Heresies and pagans | — | Cathars, Bogomils, Baltic pagans, Tengrism |

Planned: a church office track parallel to the secular one, unrest when a ruler and the people differ in faith, and crusade and jihad calls as player-triggered events.

---

## 4. Characters

### 4.1 Start — Settled
- **You start as a nobody.** Being "somebody" means standing among real people (a clan, an office), never a starting title.
- A **single-player story line** provides the personal power fantasy, but it never grants political power or titles.
- At creation: name, country (which sets culture and religion), portrait, heraldry.

### 4.2 Attributes — Settled (draft values)
| Attribute | Drives |
|---|---|
| Strength | Melee damage, heavy gear requirements |
| Dexterity | Ranged damage, critical hits |
| Agility | Initiative, dodge |
| Vitality | HP |
| Wits | Active skill power (tactics, field medicine, command), crafting quality |

**Battle values:** Damage (min–max), Initiative, Parry/Block, Armor, Morale.
**Battle Power** is one composite number for the hero plus companions: the number that keeps going up.

### 4.3 Companions — Settled
- **3 companions** (can change later). The first unlocks in the tutorial; the second and third come later.
- Named people of the period, for example: a Cuman horse archer, a Genoese crossbowman, a Varangian axeman, a Byzantine physician, a Templar sergeant, a Vlach scout.
- Each has their own gear slots and skills. The hero plus companions is your **banner** in war.

### 4.4 Skills — Settled concept
Active skills (as in Imperial Hero) with a priority, cooldown and cost, but grounded: war cries, shield wall, field surgery, prayers. Passive skills too. No spells.

### 4.5 Items — Settled
- **Rarity:** Common (grey) → Fine (green) → Superior (blue) → Masterwork (purple) → Renowned (orange, named and player-crafted) → Relic (gold).
- **Modifiers** come from materials (Toledo steel, Damascus), the smith's mark, tempering levels (+1, +2…) and gems set into sockets by jewelers.
- **Relics** are the only "magic": believed-in bonuses, some unique in the whole world (e.g. the relics of St. Ivan of Rila). They're targets for war and theft.
- **Legendary gear** can also come only from defeating strong enemies (named warlords, bandit lords, world threats).
- **Sources:** about 50/50 drops and crafting. Drops give the dopamine; crafting gives the best tiers and drives the economy.
- **Gear slots (draft):** head, body, cloak, gloves, belt, boots, main hand, off hand, 2 rings, amulet, relic, mount, ammo.

### 4.6 Wear and breakage — Settled concept, details open
- Gear loses durability with use. A weapon at low durability has a chance to **break**. Broken gear is repaired by a smith.
- **Arrows and bolts are consumed** in PvE and in war. A ranged fighter without ammunition falls back to melee.
- **Open:** whether anything can be destroyed for good, and which items are exempt (unique pieces and relics at minimum). See future ideas.

### 4.7 Reputation — Settled
- **There is no Renown stat.** Renown is your real reputation among players.
- Every character has a public **Chronicle**: an automatic, permanent record of deeds (battles fought, offices held, items crafted, betrayals, desertions). People read it and judge.

---

## 5. Hero loop — Inputs settled, design in progress

### 5.1 Energy and health — Settled
- **Energy:** 100 max, refills in about 10 hours. A fight or gathering action costs about 5.
- **Meals restore extra energy**, capped at about 2 meals per day. Not eating is never punished; eating gives a "Well Fed" bonus.
- **HP** drops in fights and refills over time. Medicine (apothecaries) and the physician companion speed it up.

### 5.2 Activities at a node — Settled
| Activity | How it works |
|---|---|
| Fight | Encounters that fit the node's terrain, colored green, yellow or red against your Battle Power. A 10–20 second auto-battle replay (skippable), then the loot reveal. |
| Gather | Mining, logging, herbs, hunting, fishing, depending on the node. Tools wear out. Rare finds (opals, amber). |
| Contracts | A town notice board with 3–5 random daily contracts in the Imperial Hero style ("kill 6 wolves", "bring 20 pelts", "dig 10 copper", "clear the bandits at the ford"), plus one weekly. A reroll costs coin. |
| Story | Single-player chapters with choices. Each chapter ends with a boss that drops legendary gear. |
| Named enemies | Elite NPCs roaming a region (e.g. "Black Radul, the bandit lord of the Haemus passes"). Hard fights, the best drops. |

### 5.3 House — Settled
- You buy a plot in your county. The price and property tax go to the county, and the mayor sets them.
- Stages: hut → cottage → townhouse → manor.
- **What it does:** extra storage; rest (faster energy and wound recovery at home); a workshop for your profession (forge, loom, jeweler's bench), upgradable; fields; decoration (vanity, a premium-currency sink).
- Small upkeep, paused in vacation mode.

### 5.4 Farming — Settled
- Fields come with the house; more can be bought in the county's farmland.
- Crops grow in real time: wheat and barley (food), **oats** (horse and army fodder), **flax** (linen), vegetables (fast), vineyards (slow, valuable). Livestock: sheep (wool), pigs (meat), chickens.
- **Real seasons** (the calendar mirrors the real one). Seasons change yields and growth speed but never block farming.
- **Seasonal rhythm, the reverse of real life:** summer is the big growing season, when players are on holiday and play lightly and food piles up. Winter yields drop and players are at home with more time, so **winter is war season**, fought on the summer's stockpiles. Granaries and food stocks become strategic.
- A county whose main node is a farm gives better yields.
- The harvest goes to meals (energy), army rations and fodder (war), and crafting materials.

### 5.5 Progression — Settled
- **Level 1–50 at launch**, reached in about 2–3 months of normal play. Each level gives attribute points and a skill point. The cap may rise occasionally; nothing ever resets.
- Derived battle values have soft caps with diminishing returns.
- **Gathering:** everyone can gather everything. **Each gathering skill improves the more you use it** (better yields, rare-find chance, speed).
- **Crafting:** one main profession plus one secondary.

### 5.6 Session shape — Proposed
10–20 minutes, 2–3 times a day: collect what finished (harvests, travel, contracts) → take the day's contracts → spend energy on fights and gathering → craft or sell → plant and queue a journey → check politics → log out.

### 5.7 The first 10 minutes — Proposed
| Time | What happens |
|---|---|
| 0:00 | Create your character: country, name, portrait, coat of arms (about 60 seconds) |
| 1:00 | Fight a stray dog, a green item drops, equip it, Battle Power climbs from 12 to 19 with an animation |
| 3:00 | First gathering, first sale to the town merchant |
| 5:00 | Story: free a captive from bandits; they become your first companion (same culture) |
| 7:00 | Notice board and first contracts. The town hall shows the NPC mayor and the next election. Clan suggestions |
| 9:00 | A "what next" panel: buy a plot, reach level 5, finish the contract |

---

## 6. Economy — Settled (model), numbers open

All numbers are placeholders, to be tuned with the economy simulator (6.14).

### 6.1 Principles
1. **Two separate flows: goods and money.**
   - **Goods** are created by spending energy (gathering, farming) and destroyed by use (eating, wear, ammunition, siege engines, spoilage).
   - **Money** is created only by NPCs (rewards, NPC purchases) and destroyed only by NPCs (NPC sales, fees, upkeep). Trades between players move money around but never change the total.
2. **Every money source has a cap we control. Every sink grows with wealth and activity.**
3. **Energy anchors value:** 1 energy of work ≈ 1 coin at the NPC's buy price. Every base price is derived from that.
4. **Markets are local.** Goods physically sit in a town, prices differ by region, and that creates trade routes.
5. **NPCs guarantee a floor and a ceiling with wide spreads, and step back** as players trade with each other.
6. **Tune by simulation before launch. Report publicly every month after launch.**

### 6.2 Currencies
- **Coins:** the in-game money, one currency for the whole world. Kept as an account balance, not carried physically. Goods, however, are physical.
- **Premium currency** (bezant or hyperpyron, name open): bought with real money and spent on vanity, minigames and convenience. **It cannot be converted to coins** in v1.

### 6.3 Production chain
**Raw** (gathered or farmed) → **refined** (at county facilities: smelter, tannery, mill, loom, sawmill; anyone can use them for a fee paid to the county) → **crafted** (professions at workshops) → **used** (equipped, eaten, shot) → **worn out or consumed**.

| Chain | Example |
|---|---|
| Weapons | Iron ore → iron ingot → blade → sword (+ leather grip, wood) |
| Leather | Pelts → leather → gloves, boots, belts |
| Food | Grain → flour → bread; + salt → preserved rations (army biscuit) |
| Cloth | Flax → linen, + wool → gambeson |
| Ammunition | Wood + feathers + iron → arrows |
| Jewels | Rough opal → cut opal → set into a ring, amulet or weapon socket |

### 6.4 Crafting professions (one main + one secondary)
| Profession | Makes |
|---|---|
| Blacksmith | Weapons, tools |
| Armorer | Mail, helmets, plate pieces, shields |
| Bowyer and fletcher | Bows, crossbows, arrows, bolts |
| Leatherworker and tailor | Leather armor, gambesons, cloaks, boots, gloves, belts |
| Jeweler | Gem cutting, rings, amulets, socketing |
| Cook and brewer | Meals, preserved rations, ale, wine |
| Apothecary | Medicine, poultices |
| Carpenter and engineer | Siege engines, wagons, house upgrades, furniture |

### 6.5 Crafting quality
- The result's rarity is rolled from four inputs: the crafter's skill, the material quality, the workshop level, and whether the recipe belongs to the crafter's culture. Crafting can produce Common up to Renowned.
- **The crafter can steer the result** (which modifiers to favor). Drops can't be steered, so this is the crafter's edge.
- **Renowned items carry the maker's name** ("forged by Tredmus of Tarnovo"), and the maker gets a Chronicle entry. A crafter's reputation becomes a social asset.

### 6.6 Drops
- Drops give Common to Masterwork items with random modifiers, plus materials and **monster-only components** (a wolf fang, a bandit captain's seal) needed in high-level recipes, so fighters supply crafters.
- Legendary items drop only from named enemies and story bosses. Relics are unique and placed in the world.
- **No binding.** Every item, Legendary and Relic included, can be traded, sold, given or taken in war. Because items never leave circulation through binding, the gear lifecycle (6.7) is what keeps demand alive.

### 6.7 Gear lifecycle (the biggest sink)
- Durability drops with every fight and battle.
- Repairs are done by a player smith (materials and skill) or by the NPC smith (coins, and expensive).
- **Every repair lowers maximum durability a little.** Past a threshold the item is "worn out": still usable, but no longer repairable. A regularly used item lasts roughly 4–8 weeks.
- Breakage at low durability means a repair. Permanent destruction is still open (see 4.6).
- Arrows and bolts are used up with every shot.

### 6.8 Food (the second big sink)
- **Demand:** meals (up to 2 per day per player), army rations (1 per day per soldier, companions included), mount fodder on campaign, feasts.
- **Spoilage:**
  - fresh food (vegetables, meat, milk): about 3 days
  - bread: about 7 days
  - **preserved food** (grain, salted meat, cheese, biscuit, wine): months
  - granaries and house storage slow spoilage
- **Salt is strategic** because it preserves food. It comes from salt mines and coastal salt pans, so it's tied to regions.
- **Seasons:** high yields in summer, low in winter. Prices rise in winter, so storing food is a way to make money.
- The NPC sells only basic bread at a high price. Food never runs out completely, but farmers easily undercut the NPC.

### 6.9 Markets and trade
- Every town has its own market with **local** buy and sell orders.
- **Listing fee:** about 1%, destroyed. **Sales tax:** 0–10%, set by the county and paid to its treasury.
- **Inventory has weight.** You can hold more than your limit, but **while overweight you cannot travel** (as in RK). Mounts and carts add capacity. Heavy loads on the roads attract NPC bandits, so hire guards (players or NPCs).
- **Regional resources:** amber (the Baltic), tin (England), salt (scattered), silk and spices (the Levant, Anatolia), wootz steel for Damascus blades, northern furs, Burgundian wine… Culture goods are made only by that culture. This produces real trade routes.

### 6.10 The NPC merchant
Per town and per item:
- **Reference price** = the base price (anchored to energy) × a regional modifier (local abundance).
- **Prices follow the NPC's stock:** when players sell to it, its stock rises and its buying price falls; when it sells, prices rise. `price = ref × (target_stock / stock)^k`, limited to between 0.25× and 4×. Grinding one item for the NPC gets less and less profitable.
- **Wide spread:** the NPC buys at about 60% of the reference price and sells at about 150%. Players trading with each other in that band get better deals on both sides.
- **A daily buying budget per town** caps how much money the NPC creates. **The budget shrinks as player-to-player trade in that town grows**, down to a minimum of 20%. That's how the NPC steps back.
- The NPC sells only basics: Common gear, tools, seeds, basic food, common arrows. It never sells anything Superior or better.
- Junk loot (items with no crafting use) can only be sold to the NPC.

### 6.11 Where money comes from and where it goes
| Sources (money created) | Sinks (money destroyed) |
|---|---|
| Contract rewards (capped by contracts per day) | NPC sales: basics, seeds, tools |
| Coins dropped by mobs (small) | NPC repairs, recipe and skill training |
| NPC purchases (capped by town budgets) | Market listing fees, contract rerolls |
| County day labor (low wage, capped) | House plots, upgrades, upkeep (part destroyed) |
| Story rewards (one-time) | Treasury spending on NPCs: garrisons, facility upkeep, buildings, mercenaries |
| | Tournament entry fees (part destroyed), companion recruitment, church donations |

Feasts consume goods and earn a Chronicle entry plus a buff for guests. They're both a social event and a food sink.

### 6.12 The county economy (the link to politics)
- **Income:**
  - sales tax, property tax, facility fees, tolls
  - **taxes paid in goods:** 5–10% of what's gathered or farmed in the county goes into its granary and armory
- **Spending:**
  - NPC garrison wages
  - facilities
  - buying food from players for the granary
  - office salaries
  - war
  - a share paid up to the duchy and kingdom
- **The granary and the armory** are physical stockpiles for sieges and armies, controlled by the mayor.
- **A public ledger:** every treasury transaction is visible. Theft is possible but recorded forever.
- The mayor sets tax rates within limits set by duchy and kingdom law.

### 6.13 Work
- **County day labor:** spend energy for a low wage in coins, with a daily cap. It's a safety net for newcomers.
- **Player job board** (later): players with fields or workshops hire other players' energy at a wage they set.

### 6.14 Stability and monitoring
- **Indicators:** coins per active player, the daily ratio of money created to money destroyed, a price index (bread, iron ingot, arrows, common sword), and player-to-player vs NPC trade volume.
- **An automatic stabilizer:** if coins per active player rises above target, NPC buying budgets shrink and NPC prices rise a little, and the reverse when it falls. Small, slow steps, reported publicly.
- **Never:** admins printing money, or compensating players in coins (compensate with vanity or premium currency instead).
- **An economy simulator in `game-core`:** bots run daily play loops to tune the numbers before launch.
- A monthly public economy report, which also serves as content.

### 6.15 Abuse protection
- New accounts get small daily caps on gifts and trades for their first days.
- Trades far from the reference price between linked or young accounts get flagged.

### 6.16 Later
- Banking and letters of credit (the Templars), moneylenders, loans.
- A player exchange between premium currency and coins, like EVE's PLEX.
- Contracts between players (delivery, escort). Caravans.

---

## 7. Politics

### 7.1 County — Settled
- A county is run by a **mayor**. The office is **elected**, or it can be **taken by force**.
- No town tier below counties for now.
- NPCs hold every office at launch until players replace them.

### 7.2 Duchy and kingdom — Settled for now
- Dukes and kings are **elected**, as in Renaissance Kingdoms. This may change later.
- Empire-level rule is open, and so is how duchies are captured (3.1).

### 7.3 Offices and the church — Open
What each office can actually do (taxes, granary, treasury spending, laws, army command) is still to be designed.

---

## 8. Clans — Settled (v1)
- A player creates a clan and becomes its leader.
- The leader can pass on leadership, invite and kick members.
- Proposed additions: clan heraldry (generated coat of arms), a clan tag shown with names and in the Chronicle, clan chat.
- Later: treasury and storage, ranks, becoming a noble house.

---

## 9. War — Settled

### 9.1 Armies
- Many players join one army under a **general**, who moves it across the map node by node.
- **Logistics are real inventories** in the army wagon: food, arrows, spare weapons, repair materials. Wagons slow the army.
- **Food:** a ration per person per day. Running out lowers morale, then HP, then causes desertion. Foraging in enemy territory angers the locals and raises revolt risk.
- **Weapons break and ammunition runs out** during battle.

### 9.2 Field battles
- The board is a **3×3 grid of zones**: left, center and right flanks × front and rear rows, plus the **baggage train**, which can be raided. Zones hold any number of troops.
- The general sorts the army into **divisions** (historically "battles": vanguard, main, rearguard) made of player banners and NPC troops, and places them in zones.
- **Only the general commands.** Each round, every division gets one order: hold, advance, charge, loose arrows, flank, commit reserve, withdraw.
- **Each player** contributes three ways:
  1. **Preparation:** gear decides your unit type (cavalry, archer, infantry); you bring food, ammunition and spares.
  2. **Stance** (set once, changeable between rounds): follow orders, press the attack, guard the banner or the general, take prisoners, hang back (recorded in the Chronicle).
  3. **Personal fights:** in each melee zone the engine pairs heroes against enemies, and each pair is resolved as an auto-battle using your own build.
- A zone's result combines the personal fights, the NPC troop clash, terrain, morale and flanking.
- **Scheduling:** armies one node apart trigger a scheduled battle. **The defender picks the time within a window.** Rounds resolve every 1–3 hours; a battle is usually 4–6 rounds, about an evening.
- **After the battle:** Chronicle entries, wounds that need treatment, and spoils that **the general distributes**.

### 9.3 Sieges
1. **Investment:** both sides draw down food (the city granary against the attackers' wagons).
2. **Siege works:** attackers build engines over days from timber, rope and iron (an engineer profession): ladders, rams, siege towers, trebuchets, sapping. Defenders repair walls or **sally out** (which becomes a field battle).
3. **Assault:** the same round engine on a siege board (left wall, gate, right wall). Engines decide where and how hard you can attack. Defenders on walls get large bonuses.
4. **Terms:** surrender can be negotiated at any time.

### 9.4 PvP — Settled
PvP happens **only in tournaments** (opt-in, ranked, fighting snapshots of other players' setups) **and in war**. No attacks on offline players outside war.

---

## 10. Staying fresh without resets — Settled
Power wears itself down continuously:
- **Overextension:** upkeep and revolt risk grow with the number of counties held, distance from the capital, and culture or faith mismatch.
- **Logistics and wear:** winning still costs food, arrows and weapons.
- **Decay of inactive titles, plus term limits.**
- **The world director** sends threats toward the strongest realms.

---

## 11. Monetization — Early notes, not a focus yet
- A premium currency. Name open: the *hyperpyron* (the Byzantine gold coin of 1226) fits, but it was regional. The *bezant*, the name Western Europe and the crusader states used for Byzantine and Arab gold coins, was known almost everywhere. Another option is to show a local name per culture (hyperpyron, bezant, dinar).
- Spent on RK-style special minigames, mostly for vanity and decorative items, plus possibly some gear or in-game money, and convenience packs such as faster travel.
- **Tension to resolve:** selling gear or in-game money conflicts with the no-pay-to-win guardrail (section 1). Options: cosmetic gear skins only, or a strict monthly cap.

---

## 12. Art direction — Settled
- AI-generated art in **one consistent style** for now (a friend may help later).
- No paper doll. Progress is shown through portraits, item icons with rarity frames and glow, numbers, and banners.
- **Heraldry is generated in code** (SVG coats of arms for characters and clans).

---

## 13. Tech — Settled

Monorepo copying the FastCat (`D:\DEV\delivery-app`) structure: npm workspaces + Turborepo, Supabase.

```
apps/
  game/       Expo: iOS, Android, web (the player app)
  admin/      Next.js: map editor, world management, moderation (separate deploy)
packages/
  game-core/  pure TypeScript rules: combat, battle rounds, logistics, items
  shared/     Supabase client, DB types, translations (BG/EN)
  ui/         design tokens + shared components
supabase/
  migrations/ + Edge Functions (battle resolution, world tick)
```

- **The server is the authority.** Battles are resolved on the server with fixed random seeds. Clients only play back the replay.
- The admin is a separate app because the player app's web code is public. Security comes from server-side roles and row-level security.
- Mobile builds through EAS (iOS builds in the cloud, no Mac needed).
- **Risk to test early:** map and battle rendering in Expo (react-native-svg vs Skia) on phones and in browsers.
- A fresh start: nothing is reused from the old Imperium codebase.

### 13.1 Map editor (admin)
- Provinces are **drawn by hand** as vector polygons with draggable points.
- **Shared border edges** between neighboring counties: moving a border point moves it for both, so there are no gaps or overlaps.
- Only counties are drawn. Duchy, kingdom and empire borders are computed by merging counties.
- Coordinates stored as real longitude/latitude, so a historical map image can be laid underneath to trace over, and coastlines and rivers can come from real data (Natural Earth).
- Snapping to coastlines and neighboring borders.
- **Nodes:** create a standalone node, or create a new node **from the selected node**, which connects the two automatically. Roads can also be drawn between existing nodes. Node type and biome are set in a side panel.

---

## 14. Decision log
| Date | Decision |
|---|---|
| 2026-10-01 | Hero layer about 60%, politics about 40%. Hero power never decides office. |
| 2026-10-01 | 1226, mirrored to the real date. One era, no resets. Director-fired historical pressures. |
| 2026-10-01 | Start as a nobody. A separate single-player story line. Culture from country of birth. |
| 2026-10-01 | Renown = real reputation among players, supported by the Chronicle. No Renown stat. |
| 2026-10-01 | 3 companions. Auto-battle for PvE and tournaments. |
| 2026-10-01 | War with real logistics. Round-based field battles and sieges with assaults; only the general commands. |
| 2026-10-01 | PvP only in tournaments and war. |
| 2026-10-01 | The whole map ships at launch, including the Muslim realms. Religion is a system. |
| 2026-10-01 | County run by an elected mayor (or taken by force). |
| 2026-10-01 | Expo + Next.js admin monorepo like FastCat. Hand-drawn provinces. |
| 2026-10-01 | Dukes and kings elected, as in RK (for now). |
| 2026-10-01 | Hero loop: energy plus meals, IH-style contracts, house, real-season farming (summer stockpiles, winter wars), level cap 50, use-based gathering skills. |
| 2026-10-01 | Economy model: NPC-only money creation, energy as the value anchor, local markets with weight (overweight = can't travel), food spoilage and salt, no item binding, public treasury ledger with theft allowed, currency called "coins". |
