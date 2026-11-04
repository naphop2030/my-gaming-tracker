'use strict';
// "The Ashen Vale": a small open-world adventure for 1-5 level 1 heroes.
//
// How adventure files work (so you can write your own):
// - locations: places on the world map. x/y are positions on a 100 x 70 map.
//   `actions` are things to do there; each opens a scene. `encounters` are random fights on arrival.
// - paths: which locations connect. `when` locks a path until a condition is true;
//   `hidden: true` keeps it off the map entirely until then.
// - scenes: a block of narration plus choices. A choice can have a `check`
//   ({ skill: 'stealth', dc: 13 } or { ability: 'wis', dc: 12, save: true }) with
//   `success` / `failure` outcomes, or be an outcome itself.
// - outcomes can use: text, set (flags), give/take (items), gold, xp (each hero), damage (the hero
//   who chose), healAll, quest ({ id, title, text, done }), goto (location), scene (next scene),
//   combat (list of monster ids, with `win` outcome and `flee: false`), end ({ title, text }).
// - conditions (`when`) are flag names, 'item:<id>', or '!...' to negate. Arrays mean "all of".
//   Every scene you open sets the flag 'seen:<scene id>'.
// - In text, {name} becomes the name of the hero who made the choice.

module.exports = {
  id: 'ashen-vale',
  title: 'The Ashen Vale',
  blurb: 'Ash is falling on the village of Thornwick and the crops are dying. The great bell at the abbey has gone silent. Find out why, and find your own way in.',
  start: 'thornwick',
  startGold: 15,
  startItems: { potion: 1 },
  intro: 'For two hundred years the Cinder Bell of Saint Aldric\'s Abbey has rung at every dusk. Three weeks ago it fell silent. Since then, grey ash has drifted down over the Vale like slow snow, and the fields of Thornwick have begun to wither.\n\nYou arrive in Thornwick at midday, with lanterns burning against the gloom.',
  defeat: 'Darkness takes you... You wake in a bed at the Sleeping Ember, bandaged and sore. A farmer found you and carted you back to Thornwick. Your purse is lighter than it was.',

  items: {
    potion: { name: 'Healing potion', desc: 'Restores 2d4+2 hit points. Can bring a fallen ally back.', heal: '2d4+2' },
    'abbey-key': { name: 'Abbot Corwin\'s key', desc: 'A heavy iron key stamped with a bell. It opens the abbey gates.' },
    'moon-charm': { name: 'Moon charm', desc: 'A silver crescent from the fey stones. +1 AC for the whole party.', acBonus: 1 },
    'choir-note': { name: 'Cultist\'s note', desc: '"The Cinder Priest awaits in the tower. Let no one touch the bell."' },
  },

  monsters: {
    wolf: { name: 'Wolf', hp: 9, ac: 13, atk: 3, dmg: '1d6+1', xp: 50, init: 2, save: 2, verb: 'snaps at' },
    spider: { name: 'Giant Spider', hp: 13, ac: 13, atk: 4, dmg: '1d6+2', xp: 50, init: 3, save: 3, verb: 'bites' },
    bandit: { name: 'Bandit', hp: 11, ac: 12, atk: 3, dmg: '1d6+1', xp: 25, init: 1, save: 1, verb: 'slashes at' },
    vesh: { name: 'Redcap Vesh', hp: 24, ac: 14, atk: 4, dmg: '1d4+2', attacks: 2, xp: 200, init: 3, save: 3, verb: 'cuts at' },
    zombie: { name: 'Bog Zombie', hp: 20, ac: 8, atk: 3, dmg: '1d6+1', xp: 50, init: -2, save: -2, verb: 'claws at' },
    skeleton: { name: 'Skeletal Monk', hp: 13, ac: 13, atk: 4, dmg: '1d6+2', xp: 50, init: 2, save: 2, verb: 'swings a censer at' },
    cultist: { name: 'Ash Cultist', hp: 9, ac: 12, atk: 3, dmg: '1d6+1', xp: 25, init: 1, save: 1, verb: 'stabs at' },
    priest: { name: 'The Cinder Priest', hp: 42, ac: 13, atk: 5, dmg: '2d6+1', xp: 450, init: 1, save: 3, verb: 'hurls fire at' },
  },

  locations: {
    thornwick: {
      name: 'Thornwick', region: 'Village', x: 50, y: 60, safe: true,
      desc: 'Thornwick huddles around a stone well in the crook of the Vale. Ash settles on thatched roofs and on fields that should be green by now. Folk hurry between doorways with scarves over their mouths.',
      descIf: [{ when: 'bell-rung', text: 'The ash has stopped falling. Children are chasing each other through the last grey drifts, and someone has started singing in the tavern.' }],
      inn: { name: 'the Sleeping Ember', price: 10 },
      shop: [{ item: 'potion', price: 25 }],
      actions: [
        { label: 'Speak with Elder Maren', scene: 'elder', when: '!seen:elder' },
        { label: 'Ask Elder Maren for advice', scene: 'elder-again', when: ['seen:elder', '!bell-rung'] },
        { label: 'Read the notice board', scene: 'board' },
        { label: 'Buy a round and listen for rumors', scene: 'rumors', cost: 2, when: '!seen:rumors' },
        { label: 'Visit Tamsin the miller', scene: 'miller', when: ['q-lina', '!lina-rescued'] },
        { label: 'Bring Lina home to the mill', scene: 'miller-thanks', when: ['lina-rescued', '!lina-home'] },
        { label: 'Report to Elder Maren', scene: 'elder-end', when: ['bell-rung', '!seen:elder-end'] },
      ],
    },

    'old-road': {
      name: 'The Old Road', region: 'Crossroads', x: 50, y: 40,
      desc: 'A rutted road of old imperial stone runs north through dead heather. Four ways meet at a leaning waystone: west into Whisperwood, east toward the reek of Greyfen, north-west to a broken watchtower, and north, up long switchbacks, to the abbey.',
      encounters: [
        { when: '!wolves-cleared', chance: 0.45, groups: [['wolf', 'wolf'], ['wolf']] },
        { chance: 0.15, groups: [['bandit', 'bandit']] },
      ],
      actions: [
        { label: 'Investigate the overturned wagon', scene: 'wagon', when: '!seen:wagon' },
        { label: 'Track the wolf pack to its den', scene: 'wolf-den', when: ['q-wolves', '!wolves-cleared'] },
      ],
    },

    whisperwood: {
      name: 'Whisperwood', region: 'Forest', x: 25, y: 42,
      desc: 'Old trees lean together overhead, their leaves curled and grey. Strands of web glint between the trunks. Somewhere deeper in, something clicks. It sounds like a lot of somethings.',
      encounters: [{ chance: 0.3, groups: [['spider'], ['wolf', 'wolf']] }],
      actions: [
        { label: 'Search the woods for Lina', scene: 'lina', when: ['q-lina', '!lina-rescued'] },
        { label: 'Approach the ring of standing stones', scene: 'stones', when: '!stones-done' },
      ],
    },

    hollow: {
      name: 'Hermit\'s Hollow', region: 'Hills', x: 9, y: 24, safe: true,
      desc: 'A crooked cottage sits in a fold of the hills, smoke curling from a chimney shaped like a teapot. Herbs hang drying from every eave. A goat regards you with deep suspicion.',
      actions: [
        { label: 'Knock on the door', scene: 'hermit', when: '!seen:hermit' },
        { label: 'Visit Sable again', scene: 'hermit-again', when: 'seen:hermit' },
      ],
    },

    watchtower: {
      name: 'Redcap Watchtower', region: 'Ruins', x: 29, y: 16,
      desc: 'A broken tower of grey stone leans over the hill road. Red rags flutter from its top, the mark of Redcap Vesh\'s crew. Smoke rises from a cookfire in the courtyard.',
      descIf: [{ when: 'vesh-done', text: 'The bandits keep their distance now, and watch you with wary respect.' }],
      actions: [
        { label: 'Walk into the bandit camp', scene: 'camp', when: '!vesh-done' },
      ],
    },

    greyfen: {
      name: 'Greyfen Marsh', region: 'Marsh', x: 76, y: 46,
      desc: 'The road dissolves into black water and reeds. Pale lights drift over the marsh, always a little further away. The air smells of rot and old smoke.',
      encounters: [{ chance: 0.4, groups: [['zombie'], ['zombie', 'zombie']] }],
      actions: [
        { label: 'Follow the drifting lights', scene: 'wisps', when: '!seen:wisps' },
        { label: 'Search for the old crypt', scene: 'crypt-find', when: '!crypt-found' },
      ],
    },

    crypt: {
      name: 'The Sunken Crypt', region: 'Underground', x: 84, y: 21,
      desc: 'Water drips through the vaulted ceiling. Stone monks lie on top of their tombs with their hands folded. Some of the tombs are open, and empty.',
      actions: [
        { label: 'Explore the burial halls', scene: 'crypt-hall', when: '!crypt-cleared' },
        { label: 'Examine the statue of Saint Aldric', scene: 'statue', when: '!undercroft-open' },
      ],
    },

    abbey: {
      name: 'Saint Aldric\'s Abbey', region: 'Abbey', x: 55, y: 8,
      desc: 'The abbey courtyard lies knee-deep in ash. Above it looms the bell tower, its great bronze bell hanging silent. Somewhere inside, voices chant in a language that crackles like fire.',
      descIf: [{ when: 'bell-rung', text: 'Clean wind blows through the courtyard now. The Cinder Bell hums faintly, even at rest.' }],
      actions: [
        { label: 'Cross the courtyard', scene: 'courtyard', when: '!courtyard-clear' },
        { label: 'Climb the bell tower', scene: 'tower', when: ['courtyard-clear', '!bell-rung'] },
      ],
    },
  },

  paths: [
    { a: 'thornwick', b: 'old-road' },
    { a: 'old-road', b: 'whisperwood' },
    { a: 'old-road', b: 'greyfen' },
    { a: 'old-road', b: 'watchtower' },
    { a: 'old-road', b: 'abbey', when: 'item:abbey-key', locked: 'The abbey gates are sealed. You need Abbot Corwin\'s key, or another way in.' },
    { a: 'whisperwood', b: 'hollow' },
    { a: 'hollow', b: 'watchtower', when: 'hermit-trail', hidden: true },
    { a: 'greyfen', b: 'crypt', when: 'crypt-found', hidden: true },
    { a: 'crypt', b: 'abbey', when: 'undercroft-open', hidden: true },
  ],

  scenes: {
    // ---------------- Thornwick ----------------
    elder: {
      title: 'Elder Maren',
      text: 'Elder Maren leans on a blackthorn staff by the well. "Travelers. Good. We need fresh legs." She squints up at the falling ash. "The monks of Saint Aldric rang the Cinder Bell every dusk for two hundred years, to keep the old fire under the hill asleep. Three weeks ago it stopped. Nobody who has gone up the north road since has come back, and the abbey gates are sealed."',
      choices: [
        {
          label: '"We\'ll find out what happened at the abbey."',
          text: 'Maren presses a small purse into your hand. "For supplies. Thornwick won\'t forget this."',
          gold: 20, set: 'q-bell',
          quest: { id: 'bell', title: 'The Silent Bell', text: 'Find out why the Cinder Bell of Saint Aldric\'s Abbey fell silent. The gates are sealed: find Abbot Corwin\'s key, or another way in.' },
        },
        {
          label: '"Saving a village is thirsty work. What\'s it worth?"',
          check: { skill: 'persuasion', dc: 12 },
          success: {
            text: 'Maren snorts, but she is smiling. "Bold. Fine." She hands over a heavier purse. "Don\'t drink it all."',
            gold: 45, set: 'q-bell',
            quest: { id: 'bell', title: 'The Silent Bell', text: 'Find out why the Cinder Bell of Saint Aldric\'s Abbey fell silent. The gates are sealed: find Abbot Corwin\'s key, or another way in.' },
          },
          failure: {
            text: '"Your reward is a harvest that doesn\'t rot in the field," she says flatly, then sighs and gives you a few coins anyway.',
            gold: 10, set: 'q-bell',
            quest: { id: 'bell', title: 'The Silent Bell', text: 'Find out why the Cinder Bell of Saint Aldric\'s Abbey fell silent. The gates are sealed: find Abbot Corwin\'s key, or another way in.' },
          },
        },
      ],
    },

    'elder-again': {
      title: 'Elder Maren',
      text: 'Maren looks up hopefully as you approach. "Any news?"',
      choices: [
        { label: 'Ask about the abbey key', text: '"Abbot Corwin wore it on a chain round his neck. Bandits have been squatting in the old watchtower since spring: Redcap Vesh\'s lot. If anyone\'s picked it up, they\'d know."', set: 'hint-vesh', scene: 'elder-again' },
        { label: 'Ask about other ways into the abbey', text: '"The monks buried their dead in a crypt under Greyfen, back when the marsh was a meadow. They say there\'s a passage from there up to the abbey cellars. Nobody goes into the fen any more, mind."', set: 'hint-crypt', scene: 'elder-again' },
      ],
    },

    'elder-end': {
      title: 'Elder Maren',
      text: 'Maren grips your hands and doesn\'t let go for a long moment. "You did it. Saint Aldric\'s bones, you actually did it." The whole village seems to have gathered behind her.',
      choices: [
        { label: 'Accept their thanks', text: 'They press gifts on you: bread, cheese, two potions from the healer, and a purse from every household that can spare one. Tonight, no one in Thornwick lets you pay for a drink.', gold: 100, give: { potion: 2 }, quest: { id: 'bell', done: true, text: 'The Cinder Bell rings again, and the Vale is saved.' } },
      ],
      noLeave: true,
    },

    board: {
      title: 'The notice board',
      text: 'Pinned notices flutter in the ash-laden wind.',
      choices: [
        {
          label: 'Take the notice: "WOLVES on the Old Road. 30 gold to whoever drives off the pack."',
          when: '!q-wolves', set: 'q-wolves', scene: 'board',
          quest: { id: 'wolves', title: 'Wolves on the Old Road', text: 'A wolf pack is attacking travelers on the Old Road. Find their den and drive them off.' },
        },
        {
          label: 'Take the notice: "MISSING: Lina, daughter of Tamsin the miller. Last seen near Whisperwood."',
          when: '!q-lina', set: 'q-lina', scene: 'board',
          quest: { id: 'lina', title: 'The Miller\'s Daughter', text: 'Lina went looking for mushrooms near Whisperwood and never came home. Talk to Tamsin the miller, then search the woods.' },
        },
        {
          label: 'Claim the wolf bounty',
          when: ['wolves-cleared', '!wolves-paid'],
          text: 'A warden counts out thirty coins and tears the notice down. "Good riddance to them."',
          gold: 30, xp: 100, set: 'wolves-paid', scene: 'board',
          quest: { id: 'wolves', done: true, text: 'The wolf pack has been driven off, and the bounty paid.' },
        },
      ],
    },

    rumors: {
      title: 'The Sleeping Ember',
      text: 'The tavern is crowded and grim. A round of ale loosens a few tongues:\n- "My cousin swears the bandits at the watchtower are drinking out of monks\' silver cups."\n- "Don\'t follow the lights in Greyfen. Not ever."\n- "There\'s a hermit out west, Sable, who used to be the abbey\'s librarian. She knows more about that bell than anyone alive."',
      choices: [
        { label: 'Thank them and finish your drink', set: ['hint-vesh', 'hint-hermit'] },
      ],
      noLeave: true,
    },

    miller: {
      title: 'Tamsin the miller',
      text: 'Tamsin hasn\'t slept; it\'s written all over her face. "Lina always goes to the mushroom patch past the old stones in Whisperwood. I told her it wasn\'t safe any more. Please, bring her back."',
      choices: [
        { label: '"We\'ll find her."', text: 'Tamsin nods, unable to speak, and squeezes your arm.', quest: { id: 'lina', text: 'Search Whisperwood for Lina.' } },
      ],
    },

    'miller-thanks': {
      title: 'The mill',
      text: 'Lina breaks away from you and runs. Tamsin catches her halfway across the yard, and for a while nobody says anything at all.',
      choices: [
        {
          label: 'Leave them be',
          text: 'Later, Tamsin finds you. "It isn\'t much," she says, pressing two potions and a pouch of coins on you. "But it\'s yours."',
          give: { potion: 2 }, gold: 20, xp: 150, set: 'lina-home',
          quest: { id: 'lina', done: true, text: 'Lina is home safe.' },
        },
      ],
      noLeave: true,
    },

    // ---------------- Old Road ----------------
    wagon: {
      title: 'The overturned wagon',
      text: 'A merchant\'s wagon lies on its side in the ditch, one wheel still turning. Pinned underneath is a portly man in a green coat, wheezing. "Please! The horse bolted... wolves..."',
      choices: [
        {
          label: 'Lift the wagon off him',
          check: { skill: 'athletics', dc: 12 },
          success: { text: '{name} heaves, and the wagon lifts just enough for him to wriggle free. "Odo Pell, merchant of fine sundries! Take these, with my undying thanks."', give: { potion: 1 }, gold: 15, xp: 50, set: 'odo-saved' },
          failure: { text: 'The wagon shifts, then slams back down. {name} wrenches a shoulder. Odo whimpers.', damage: '1d4', scene: 'wagon' },
        },
        {
          label: 'Lever it up with a fallen branch',
          check: { skill: 'investigation', dc: 10 },
          success: { text: '{name} wedges a branch under the axle and leans on it. It creaks, and Odo scrambles out. "Brains AND kindness! Here, take these."', give: { potion: 1 }, gold: 15, xp: 50, set: 'odo-saved' },
          failure: { text: 'The branch snaps with a crack and the wagon lurches. A splinter catches {name}\'s hand.', damage: '1d3', scene: 'wagon' },
        },
        {
          label: 'Grab his coin purse and walk away',
          text: 'Odo\'s eyes go wide as {name} cuts the purse from his belt. His curses follow you down the road. Eventually a passing farmer frees him.',
          gold: 35, set: 'odo-robbed',
        },
      ],
    },

    'wolf-den': {
      title: 'The wolf den',
      text: 'You follow tracks and tufts of torn wool to a hollow under a fallen oak. In the dark beneath the roots, yellow eyes open one pair at a time.',
      choices: [
        {
          label: 'Attack!',
          combat: ['wolf', 'wolf', 'wolf'],
          win: { text: 'The last wolf flees yelping into the heather. The road should be safer now.', set: 'wolves-cleared', quest: { id: 'wolves', text: 'The pack is broken. Claim the bounty at the notice board in Thornwick.' } },
        },
        {
          label: 'Lure one out and pick it off first',
          check: { skill: 'survival', dc: 12 },
          success: {
            text: '{name} drags a scrap of meat along the ground. One wolf creeps out alone, and it never makes it back. The other two burst from the den, snarling.',
            combat: ['wolf', 'wolf'],
            win: { text: 'The pack is broken. The road should be safer now.', set: 'wolves-cleared', quest: { id: 'wolves', text: 'The pack is broken. Claim the bounty at the notice board in Thornwick.' } },
          },
          failure: {
            text: 'The wolves smell the trick and come out together.',
            combat: ['wolf', 'wolf', 'wolf'],
            win: { text: 'The last wolf flees yelping into the heather.', set: 'wolves-cleared', quest: { id: 'wolves', text: 'The pack is broken. Claim the bounty at the notice board in Thornwick.' } },
          },
        },
      ],
    },

    // ---------------- Whisperwood ----------------
    lina: {
      title: 'The web',
      text: 'Webs as thick as rope stretch between the trunks. Hanging in a silk cocoon and kicking weakly is a girl of about ten. Two spiders the size of dogs pick their way down toward her.',
      choices: [
        {
          label: 'Charge in!',
          combat: ['spider', 'spider'],
          win: { text: 'You cut Lina down. She clings to you, shaking. "I want to go home."', set: 'lina-rescued', quest: { id: 'lina', text: 'Bring Lina home to Tamsin in Thornwick.' } },
        },
        {
          label: 'Sneak under the webs and cut her free first',
          check: { skill: 'stealth', dc: 13 },
          success: {
            text: '{name} slips beneath the webs and slices the cocoon. Lina tumbles into waiting arms, and one spider shrieks and drops.',
            combat: ['spider'],
            win: { text: 'Lina clings to you, shaking. "I want to go home."', set: 'lina-rescued', quest: { id: 'lina', text: 'Bring Lina home to Tamsin in Thornwick.' } },
          },
          failure: {
            text: 'A strand twangs. The whole web shudders, and a spider lands on {name}\'s back.',
            damage: '1d6',
            combat: ['spider', 'spider'],
            win: { text: 'You cut Lina down. She clings to you, shaking. "I want to go home."', set: 'lina-rescued', quest: { id: 'lina', text: 'Bring Lina home to Tamsin in Thornwick.' } },
          },
        },
      ],
    },

    stones: {
      title: 'The standing stones',
      text: 'Seven moss-green stones stand in a ring where no ash falls. As you step inside, a voice like wind chimes asks: "I have cities, but no houses. Forests, but no trees. Water, but no fish. What am I?"',
      choices: [
        { label: '"A map."', text: 'The stones hum with laughter. A silver charm shaped like a crescent moon drops into {name}\'s palm. "Wear it, and harm will find you a little harder."', give: { 'moon-charm': 1 }, xp: 100, set: 'stones-done' },
        { label: '"A dream."', text: 'The wind turns cold. "No." A gust like a blade slices across {name}\'s cheek, and the stones fall silent for good.', damage: '1d4', set: 'stones-done' },
        { label: '"A painting."', text: 'The wind turns cold. "Close. But no." The stones fall silent for good.', set: 'stones-done' },
        {
          label: 'Study the stones for a clue',
          when: '!stones-hint',
          check: { skill: 'arcana', dc: 11 },
          success: { text: '{name} recognizes the carvings: it\'s an old fey riddle game. The answer is always something made by people that pretends to be the world.', set: 'stones-hint', scene: 'stones' },
          failure: { text: 'The carvings swim before {name}\'s eyes. No help there.', set: 'stones-hint', scene: 'stones' },
        },
      ],
    },

    // ---------------- Hermit's Hollow ----------------
    hermit: {
      title: 'Sable the hermit',
      text: 'The door opens before you can knock. A tiny woman with spectacles on a chain peers up at you. "Sable. Former archivist of Saint Aldric\'s, until they threw me out for reading the wrong books. You\'re here about the bell." It isn\'t a question.\n\n"That bell doesn\'t just ring. It sings the Ember Wyrm to sleep. Somebody stopped it on purpose. The Ashen Choir, I\'d wager: fire-worshippers, mad as hatters."',
      choices: [
        {
          label: '"How do we get inside the abbey?"',
          text: '"Two ways. Corwin\'s key: I\'ve seen bandits on the hill road wearing monks\' silver, so try Redcap Vesh at the old watchtower. Or the Undercroft: the crypt under Greyfen connects to the abbey cellars. There\'s a lever behind Saint Aldric\'s statue. Mind the dead." She sketches a shortcut to the watchtower on your map.',
          set: ['hermit-trail', 'hint-vesh', 'hint-crypt'], scene: 'hermit',
          quest: { id: 'bell', text: 'Get into the abbey: take Abbot Corwin\'s key from Redcap Vesh at the watchtower, or find the crypt in Greyfen and the lever behind Saint Aldric\'s statue.' },
        },
        { label: '"What is the Ember Wyrm?"', text: '"Old. Older than the Vale. It sleeps in the heart of the hill, and while it sleeps the soil is warm and rich. Wake it fully, and..." She waves at the ash. "That\'s it yawning."', scene: 'hermit' },
        { label: '"Is there anything you can give us?"', when: '!sable-gift', text: 'She shoves two stoppered bottles at you. "Tastes like regret. Works, though."', give: { potion: 2 }, set: 'sable-gift', scene: 'hermit' },
      ],
    },

    'hermit-again': {
      title: 'Sable the hermit',
      text: '"Back again? Don\'t touch the goat."',
      choices: [
        { label: 'Rest by her fire', text: 'You sleep by Sable\'s hearth while she mutters over old books. You wake fully rested, and the goat has eaten someone\'s bootlace.', healAll: true },
      ],
    },

    // ---------------- Watchtower ----------------
    camp: {
      title: 'Redcap Vesh',
      text: 'A dozen bandits lounge around the fire, drinking from silver chalices that very clearly belonged to monks. On a throne made from a cart seat sits Redcap Vesh: scarred, grinning, with a heavy iron key hanging on a chain around her neck. "Visitors! Lost, or stupid?"',
      choices: [
        {
          label: 'Lift the key from her neck while she gloats',
          check: { skill: 'sleight', dc: 14 },
          success: { text: 'While Vesh laughs at her own joke, {name}\'s fingers find the clasp. By the time she notices, you are long gone up the hill road.', give: { 'abbey-key': 1 }, xp: 150, set: 'vesh-done', quest: { id: 'bell', text: 'You have Abbot Corwin\'s key. The road to the abbey is open from the Old Road.' } },
          failure: {
            text: 'Vesh\'s hand clamps around {name}\'s wrist. "Cheeky." She whistles, and her crew draws steel.',
            combat: ['bandit', 'bandit', 'vesh'],
            win: { text: 'Vesh yields, bleeding. "Take the cursed key! Those Choir freaks up there stopped paying us anyway." The rest of her crew scatters.', give: { 'abbey-key': 1 }, set: 'vesh-done', quest: { id: 'bell', text: 'You have Abbot Corwin\'s key. The road to the abbey is open from the Old Road.' } },
          },
        },
        {
          label: 'Talk to her',
          check: { skill: 'persuasion', dc: 13 },
          success: { text: '"The abbey?" Vesh spits. "We took this key off a dead monk on the road. Those Choir freaks paid us to stop carrying supplies up there, then stopped paying. Take it. Burn them for me."', give: { 'abbey-key': 1 }, xp: 150, set: 'vesh-done', quest: { id: 'bell', text: 'You have Abbot Corwin\'s key. The road to the abbey is open from the Old Road.' } },
          failure: { text: '"Nah," Vesh says. "But I\'ll sell it to you. Fifty gold, and I won\'t even rob you first."', scene: 'camp-buy' },
        },
        {
          label: 'Frighten her into giving it up',
          check: { skill: 'intimidation', dc: 15 },
          success: { text: 'Something in {name}\'s voice makes the fire seem to dim. Vesh swallows, lifts the chain over her head and tosses it over. "Just go."', give: { 'abbey-key': 1 }, xp: 150, set: 'vesh-done', quest: { id: 'bell', text: 'You have Abbot Corwin\'s key. The road to the abbey is open from the Old Road.' } },
          failure: {
            text: 'Vesh grins wider. "I like this one. Kill them."',
            combat: ['bandit', 'bandit', 'vesh'],
            win: { text: 'Vesh yields, bleeding. "Take the cursed key!" Her crew scatters.', give: { 'abbey-key': 1 }, set: 'vesh-done', quest: { id: 'bell', text: 'You have Abbot Corwin\'s key. The road to the abbey is open from the Old Road.' } },
          },
        },
        {
          label: 'Attack!',
          combat: ['bandit', 'bandit', 'vesh'],
          win: { text: 'Vesh yields, bleeding. "Take the cursed key!" Her crew scatters.', give: { 'abbey-key': 1 }, set: 'vesh-done', quest: { id: 'bell', text: 'You have Abbot Corwin\'s key. The road to the abbey is open from the Old Road.' } },
        },
      ],
    },

    'camp-buy': {
      title: 'Redcap Vesh',
      text: 'Vesh dangles the key from one finger. "Fifty. Going once..."',
      choices: [
        { label: 'Pay 50 gold', cost: 50, text: 'Vesh bites a coin, laughs, and tosses you the key. "Pleasure doing business."', give: { 'abbey-key': 1 }, set: 'vesh-done', quest: { id: 'bell', text: 'You have Abbot Corwin\'s key. The road to the abbey is open from the Old Road.' } },
        {
          label: 'Take it by force',
          combat: ['bandit', 'bandit', 'vesh'],
          win: { text: 'Vesh yields, bleeding. "Take the cursed key!" Her crew scatters.', give: { 'abbey-key': 1 }, set: 'vesh-done', quest: { id: 'bell', text: 'You have Abbot Corwin\'s key. The road to the abbey is open from the Old Road.' } },
        },
      ],
    },

    // ---------------- Greyfen ----------------
    wisps: {
      title: 'The drifting lights',
      text: 'The lights bob invitingly between the reeds. You hear whispering: your own names, spoken in voices you almost know.',
      choices: [
        {
          label: 'Follow them, carefully',
          check: { ability: 'wis', dc: 13, save: true },
          success: { text: '{name} tests every step and refuses to hurry. The lights grow bored and wink out, leaving behind a drowned shrine and a pouch of old coins.', gold: 40, xp: 50 },
          failure: { text: 'The ground gives way. {name} claws free of the sucking mud, half-drowned, as the lights giggle and fade.', damage: '2d4' },
        },
        { label: 'Ignore them', text: 'Wise. Probably.' },
      ],
    },

    'crypt-find': {
      title: 'Searching the fen',
      text: 'Somewhere under all this black water there was once a meadow and a monks\' graveyard.',
      choices: [
        { label: 'Follow Sable\'s map', when: 'hermit-trail', text: 'Sable\'s sketch leads you to a stair choked with moss, going down under the water line.', set: 'crypt-found', xp: 50 },
        {
          label: 'Search the marsh',
          check: { skill: 'survival', dc: 13 },
          success: { text: '{name} spots carved stone among the reeds: the top of a moss-choked stair leading down.', set: 'crypt-found', xp: 50 },
          failure: { text: 'Hours of wading, leeches, and nothing to show for it.', damage: '1d4' },
        },
      ],
    },

    // ---------------- Crypt ----------------
    'crypt-hall': {
      title: 'The burial halls',
      text: 'Bones rattle. From the open tombs, skeletal monks rise, each one holding a rusted censer like a mace.',
      choices: [
        { label: 'Fight!', combat: ['skeleton', 'skeleton'], win: { text: 'They collapse into dust. In a monk\'s satchel among the bones, you find a healing potion.', give: { potion: 1 }, set: 'crypt-cleared' } },
        {
          label: 'Hold up a holy symbol and command them to rest',
          check: { skill: 'religion', dc: 14 },
          success: { text: '{name} speaks the old rites. One by one the skeletons bow their heads and lie back down in their tombs.', xp: 100, set: 'crypt-cleared' },
          failure: { text: 'The skeletons hesitate... then keep coming.', combat: ['skeleton', 'skeleton'], win: { text: 'They collapse into dust.', set: 'crypt-cleared' } },
        },
      ],
    },

    statue: {
      title: 'Saint Aldric\'s statue',
      text: 'A weathered statue of Saint Aldric cradles a stone bell. Behind it there is a seam in the wall that looks too straight to be natural.',
      choices: [
        { label: 'Pull the lever Sable described', when: 'hermit-trail', text: 'You reach behind the statue\'s bell and pull. Grinding stone. A narrow stair spirals up into the dark, toward the abbey.', set: 'undercroft-open', xp: 100 },
        {
          label: 'Search for a mechanism',
          check: { skill: 'investigation', dc: 12 },
          success: { text: '{name} finds a lever hidden behind the stone bell. With a grinding of stone, a narrow stair opens, spiraling up toward the abbey.', set: 'undercroft-open', xp: 100 },
          failure: { text: '{name} finds a lever, and the dart trap beside it.', damage: '1d6', scene: 'statue' },
        },
        {
          label: 'Force the seam open',
          check: { skill: 'athletics', dc: 15 },
          success: { text: '{name} gets their fingers into the seam and heaves. The wall grinds aside to reveal a stair going up.', set: 'undercroft-open', xp: 100 },
          failure: { text: 'It doesn\'t budge. {name}\'s back does, slightly.', damage: '1d4', scene: 'statue' },
        },
      ],
    },

    // ---------------- Abbey ----------------
    courtyard: {
      title: 'The courtyard',
      text: 'Robed figures with ash-smeared faces turn toward you as one. "The Wyrm wakes," they chant. "The Wyrm WAKES!"',
      choices: [
        { label: 'Fight!', combat: ['cultist', 'cultist', 'cultist'], win: { text: 'Among the fallen cultists you find a scrap of parchment and a healing potion. The bell tower door stands open.', give: { 'choir-note': 1, potion: 1 }, set: 'courtyard-clear', quest: { id: 'bell', text: 'The Cinder Priest waits at the top of the bell tower. Rest first if you need to.' } } },
        {
          label: 'Pull up a hood and slip past them',
          check: { skill: 'deception', dc: 13 },
          success: { text: '{name} smears on some ash, joins the chant, and you all drift toward the tower door. Nobody looks twice.', set: 'courtyard-clear', xp: 75, quest: { id: 'bell', text: 'The Cinder Priest waits at the top of the bell tower. Rest first if you need to.' } },
          failure: { text: '"Heretic!" shrieks the nearest cultist.', combat: ['cultist', 'cultist', 'cultist'], win: { text: 'The courtyard falls quiet. The bell tower door stands open.', give: { potion: 1 }, set: 'courtyard-clear', quest: { id: 'bell', text: 'The Cinder Priest waits at the top of the bell tower. Rest first if you need to.' } } },
        },
      ],
    },

    tower: {
      title: 'The bell tower',
      text: 'At the top of the tower, the Cinder Priest stands beside the great bell. Its clapper is bound in chains of glowing iron. Ash swirls around her like a living cloak. "You\'re too late," she says. "Listen. You can hear it breathing."',
      choices: [
        { label: 'Fight!', combat: ['priest', 'cultist', 'cultist'], flee: false, win: { text: 'The Cinder Priest falls. The glowing chains on the clapper flicker, crack, and go dark.', scene: 'ring' } },
        {
          label: 'Try to talk her down',
          check: { skill: 'persuasion', dc: 17 },
          success: { text: 'Her certainty cracks. "If it wakes... we all burn. Don\'t we." She drops her staff, and the chains on the clapper go dark.', xp: 200, scene: 'ring' },
          failure: { text: '"Unbelievers!" Fire blooms in her hands.', combat: ['priest', 'cultist', 'cultist'], flee: false, win: { text: 'The Cinder Priest falls. The glowing chains on the clapper flicker, crack, and go dark.', scene: 'ring' } },
        },
      ],
      noLeave: true,
    },

    ring: {
      title: 'The Cinder Bell',
      text: 'The chains slide away from the clapper. The great bell hangs before you, waiting.',
      choices: [
        {
          label: 'Ring the Cinder Bell',
          set: 'bell-rung', xp: 300,
          quest: { id: 'bell', text: 'The bell rings again. Return to Elder Maren in Thornwick.' },
          end: {
            title: 'The Bell Sings Again',
            text: 'A deep note rolls out over the Vale, then another, and another. Far below, the hill sighs like a sleeper turning over. The ash stops falling. By the time you reach the bottom of the tower, the sky is blue for the first time in three weeks.\n\nThornwick will want to thank you. And the Vale is still wide open.',
          },
        },
      ],
      noLeave: true,
    },
  },
};
