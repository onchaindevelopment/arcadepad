/*
 * Crate Push: hand-made levels, ordered easy to hard. The later ones were
 * picked from runs of our own generator (gen.ts) and named by hand.
 * ArcadePad, GPL-3.0-or-later. All layouts are original to ArcadePad
 * (no published level set was used). Every level is checked by the BFS
 * solver in crates.test.ts.
 *
 * '#' wall, ' ' floor, '.' wallet pad, '$' coin crate, '*' crate on pad,
 * '@' player, '+' player on pad. Max 10x10.
 */

export interface LevelDef {
  name: string;
  rows: string[];
}

export const LEVELS: LevelDef[] = [
  {
    name: "First Deposit",
    rows: [
      "#######",
      "#@ $ .#",
      "#######",
    ],
  },
  {
    name: "Side Step",
    rows: [
      "######",
      "#.   #",
      "# $# #",
      "#  @ #",
      "######",
    ],
  },
  {
    name: "Two Wallets",
    rows: [
      "#######",
      "#.   .#",
      "# $ $ #",
      "#  @  #",
      "#######",
    ],
  },
  {
    name: "Corner Shop",
    rows: [
      "######",
      "#  @ #",
      "# $$ #",
      "##  ##",
      " #..# ",
      " #### ",
    ],
  },
  {
    name: "Pillar",
    rows: [
      "#######",
      "#  .  #",
      "# $#$ #",
      "#  .  #",
      "#  @  #",
      "#######",
    ],
  },
  {
    name: "Back Office",
    rows: [
      " ######",
      "##  . #",
      "#  $# #",
      "# $  .#",
      "#  @  #",
      "#######",
    ],
  },
  {
    name: "Clearing House",
    rows: [
      " ####### ",
      " #  .  # ",
      "## $#$ ##",
      "#  .@.  #",
      "## $#$ ##",
      " #  .  # ",
      " ####### ",
    ],
  },
  {
    name: "Bull Pen",
    rows: [
      "########",
      "#  #   #",
      "# $  $ #",
      "#  ##  #",
      "#.$  . #",
      "#.  @  #",
      "########",
    ],
  },
  {
    name: "Three Coins",
    rows: [
      "#######",
      "#. . .#",
      "#     #",
      "# $$$ #",
      "#  @  #",
      "#######",
    ],
  },
  {
    name: "Switchback",
    rows: [
      "#######",
      "#.    #",
      "#.### #",
      "#  $  #",
      "# #$# #",
      "#  @  #",
      "#######",
    ],
  },
  {
    name: "Bear Trap",
    rows: [
      "#########",
      "#  .#.  #",
      "# $   $ #",
      "##$ # $##",
      "#  .#.  #",
      "#   @   #",
      "#########",
    ],
  },
  {
    name: "Quick Swap",
    rows: [
      "########",
      "#      #",
      "#  $@. #",
      "#  $#  #",
      "#   #  #",
      "#. #####",
      "####",
    ],
  },
  {
    name: "Side Door",
    rows: [
      "#####",
      "#   ###",
      "#   $@#",
      "#     #",
      "# . $##",
      "#.   #",
      "######",
    ],
  },
  {
    name: "Stair Case",
    rows: [
      "########",
      "#@     #",
      "# $$## #",
      "##  #  #",
      " # $ . #",
      " #.  . #",
      " #######",
    ],
  },
  {
    name: "Cold Wallet",
    rows: [
      "#########",
      "#@  #   #",
      "# $   $ #",
      "## ##$# #",
      "#  . .  #",
      "# $ #.  #",
      "#  .#####",
      "#####    ",
    ],
  },
  {
    name: "Back Room",
    rows: [
      "   #####",
      "####.  #",
      "#    # #",
      "#     .#",
      "# $$ . #",
      "# $@####",
      "#  ##",
      "####",
    ],
  },
  {
    name: "Loading Dock",
    rows: [
      "   ######",
      "   #    #",
      " ### #  #",
      "##@     #",
      "# $$#  .#",
      "#  $ #  #",
      "#  ..####",
      "######",
    ],
  },
  {
    name: "Three Steps",
    rows: [
      " ######",
      "##    #",
      "#  $  #",
      "#.. $##",
      "#  #@#",
      "#  .$#",
      "#    #",
      "######",
    ],
  },
  {
    name: "Long Way Round",
    rows: [
      "########",
      "#.  #  #",
      "# # #$.#",
      "#   #  #",
      "#    $@#",
      "#   #  #",
      "########",
    ],
  },
  {
    name: "Split Vault",
    rows: [
      "########",
      "#  #  .#",
      "# $#   #",
      "#   #  #",
      "#    $+#",
      "#####$ #",
      "    # .#",
      "    ####",
    ],
  },
  {
    name: "Triple Stack",
    rows: [
      "    ####",
      "  ###  ##",
      "###    .#",
      "#. @ .  #",
      "# $$$ ###",
      "##  $   #",
      " ###    #",
      "   ## . #",
      "    #####",
    ],
  },
  {
    name: "Pad Row",
    rows: [
      "  #####",
      "  #   ###",
      "  #  $$ #",
      "  #   $@#",
      " ##     #",
      "##. .. ##",
      "#.    $#",
      "#      #",
      "########",
    ],
  },
  {
    name: "Deep Cellar",
    rows: [
      "  #######",
      "  #. #  #",
      "###   $@#",
      "#  .#$###",
      "#     #",
      "### #$##",
      "##   $ #",
      "#      #",
      "# .#. ##",
      "#######",
    ],
  },
  {
    name: "Night Shift",
    rows: [
      " #####",
      " #   #####",
      " # # $ $ #",
      "##.      #",
      "# $ ##   #",
      "#.  ##  .#",
      "###$ # . #",
      "  #@ #####",
      "  ####",
    ],
  },
  {
    name: "Long Haul",
    rows: [
      "     ####",
      "     # .#",
      "     #  #",
      " #####$ #",
      " #   #  #",
      "##   $$ #",
      "#.   #  #",
      "#  #### #",
      "## .  $+#",
      " ########",
    ],
  },
];
