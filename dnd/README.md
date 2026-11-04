# Tabletop — a self-hosted D&D table

A small virtual tabletop for playing D&D with your friends. One person runs the server and everyone else joins from a web browser. Nothing needs to be installed on the players' side, and there are no accounts or subscriptions.

**What you get**

- **Shared battle map**: upload any map image, line up the grid and zoom/pan. Moving a token shows the distance in feet.
- **Tokens**: players move only their own tokens. The DM can move everything, hide monsters from players, resize tokens and assign them to players.
- **Dice and chat**: dice buttons or commands (`/r 1d20+5 Stealth`). Advantage and disadvantage, keep/drop (`4d6dl1`), and secret rolls that only the DM sees. Natural 20s and 1s are highlighted. All rolls happen on the server, so nobody can fake them.
- **Character sheets**: ability scores with auto modifiers, one-click checks and saves, HP with a Damage/Heal button, inventory and notes. Everyone can view the party's sheets but can only edit their own.
- **Initiative tracker**: players roll with their DEX + bonus. The DM adds monsters (secret rolls) and steps through turns and rounds.
- **Pings**: double-click the map to point at something.
- **One-screen mode**: several players can share one browser and take turns, with the view switching automatically on each initiative turn.
- Games are saved to disk, so you can stop the server and pick up next session.

## Running it

You need [Node.js](https://nodejs.org) 18 or newer on the computer that hosts the game.

```bash
cd dnd
npm install
npm start
```

The server prints the addresses to open:

```
  On this computer:   http://localhost:3000
  On your network:    http://192.168.1.23:3000
```

1. **DM:** open the address, enter your name and click **Create game as DM**.
2. Click **Copy invite** in the top bar and send the link to your players. You can also just tell them the 6-letter code.
3. **Players:** open the link, enter a name and click **Join**.

To run the game from another device (for example, a tablet at the table), open the **Map** tab and use **Copy DM link**. Keep that link private, because anyone who has it is the DM.

## Playing on one screen (hot-seat)

Everyone can also play around a single laptop or TV, with no other devices needed:

1. The DM creates the game as usual.
2. For each player at the table, click **+ Player on this device** and type their name.
3. A **Playing as** bar appears. Click a name (or press **1–8**) to switch to that person's view: their sheet, their tokens and their secret rolls. In a player's view, the DM's hidden tokens and secret rolls are not shown.
4. Leave **Switch on each initiative turn** ticked. When the DM clicks **Next turn**, the screen switches to whoever is up. On a monster's turn it switches back to the DM.

Each player on the screen still counts as a real player, so you can mix both ways of playing. For example, two friends can share a laptop while others join from their own devices. Your list of players on the device is remembered for the next session.

## Letting friends connect

| Situation | What to do |
|---|---|
| Everyone on the same Wi-Fi | Share the `On your network` address. If it doesn't load, allow Node.js through the host's firewall. |
| Playing online (easiest) | Use [Tailscale](https://tailscale.com) (free). Everyone installs it and joins your tailnet, then opens `http://<host's tailscale IP>:3000`. |
| Playing online (no install for players) | Run `cloudflared tunnel --url http://localhost:3000` ([Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)) and share the `https://…trycloudflare.com` link it prints. You get a new link each time. |
| Always-on server | Forward port 3000 on your router, or run it on any cheap VPS. Put it behind HTTPS (Caddy or nginx) if it's on the open internet. |

## Settings

Set these as environment variables, for example `PORT=8080 npm start`:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Address to bind (`127.0.0.1` = only this computer) |
| `DATA_DIR` | `./data` | Where games and uploaded maps are saved |

To wipe all games, stop the server and delete the `data` folder.

## Tips for the table

- **Line up a map:** if your map image is 30 squares wide and 20 tall, set Columns 30 and Rows 20 in the **Map** tab.
- **Keyboard:** select one of your tokens, then use the arrow keys to move it or Delete to remove it.
- **Type `/help`** in chat for all the dice commands.
- **Player names are tied to the browser.** If someone switches devices they show up as a new player, and the DM can reassign their token.

## Development

```bash
npm test   # dice parser tests + a scripted multiplayer session against the real server
```

| File | What's in it |
|---|---|
| `server.js` | HTTP + WebSocket server, game rules and permissions, saving to disk |
| `dice.js` | Dice expression parser |
| `public/` | The web app (plain HTML/CSS/JS, no build step) |

The only dependency is [`ws`](https://github.com/websockets/ws).

## Not built (yet)

Fog of war, line-of-sight, drawing on the map, and a 5e rules or monster compendium. The code is small and plain, so these are reasonable next additions.
