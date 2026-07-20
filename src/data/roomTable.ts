// AUTO-GENERATED from the original Delphi source zaklad.pas `Desc[1..72]` array.
// Do not edit by hand; regenerate via `python3 tools/gen-room-table.py`.
// Source: ~/.cache/ffng-orig/delphi-src/Fillets/zaklad.pas (decoded CP1250 -> UTF-8).
//
// Fields are faithful to the Pascal record Desc[].:
//   jmeno : 8-char room name (Desc[].Jmeno)
//   cHud  : music index (Desc[].cHud — "Hudba" = music; -1 = none). See audio/music.ts.
//   dffr  : expected byte size of the room 0NN.FFR file (integrity check, URoom.pas:1003)
//   dffs  : expected byte size of the room 0NN.FFS file (integrity check, URoom.pas:1011)
//   cz/en : room description, split from Desc[].Pop on the "^" separator

export interface RoomDesc {
  /** 1-based room number, matching the 0NN.FFR / 0NN.FFS / 0NN.FFT file index. */
  readonly num: number;
  readonly jmeno: string;
  readonly cHud: number;
  readonly dffr: number;
  readonly dffs: number;
  readonly cz: string;
  readonly en: string;
}

/** The 72 rooms, in original order (index 0 => room number 1). */
export const ROOMS: readonly RoomDesc[] = [
  { num: 1, jmeno: "PRVNI", cHud: 4, dffr: 468338, dffs: 4297587, cz: "Jak to všechno začalo", en: "How It All Started" },
  { num: 2, jmeno: "KUFRIK", cHud: -1, dffr: 1036804, dffs: 9370022, cz: "Podivná zásilka", en: "Briefcase Message" },
  { num: 3, jmeno: "PRAVIDLA", cHud: 15, dffr: 735649, dffs: 4054769, cz: "Zkouška ve sklepě", en: "Rehearsal in Cellar" },
  { num: 4, jmeno: "VRAK", cHud: 2, dffr: 445409, dffs: 3448816, cz: "Co zbylo z knihovny", en: "Library Flotsam" },
  { num: 5, jmeno: "SCHODY", cHud: 3, dffr: 825321, dffs: 748639, cz: "Zeleň na schodišti", en: "Plants on the Stairs" },
  { num: 6, jmeno: "KOSTE", cHud: 1, dffr: 670204, dffs: 1158601, cz: "Nepořádek v kotelně", en: "A Mess in the Boiler Room" },
  { num: 7, jmeno: "UTES", cHud: 5, dffr: 449522, dffs: 1769449, cz: "Pod útesem", en: "Under the Reef" },
  { num: 8, jmeno: "WC", cHud: 10, dffr: 328837, dffs: 1551465, cz: "Zamčeni na WC", en: "Closed in the Closet" },
  { num: 9, jmeno: "ZRC", cHud: 6, dffr: 368338, dffs: 1675310, cz: "Utonulá ponorka", en: "Drowned Submarine" },
  { num: 10, jmeno: "PARTY1", cHud: 15, dffr: 1031163, dffs: 1527345, cz: "Výletní loď", en: "Picnic Boat" },
  { num: 11, jmeno: "DEUTSCHE", cHud: 9, dffr: 850401, dffs: 2869208, cz: "Velká vlastenecká válka", en: "Great War" },
  { num: 12, jmeno: "POTOPENA", cHud: 2, dffr: 347589, dffs: 2145147, cz: "Loď kapitána Silvera", en: "The Ship of Captain Silver" },
  { num: 13, jmeno: "DRAKAR1", cHud: -1, dffr: 633356, dffs: 3384394, cz: "Poslední plavba", en: "The Last Voyage" },
  { num: 14, jmeno: "LETADLO", cHud: 14, dffr: 649018, dffs: 1135070, cz: "Výška: -9000 stop", en: "Altitude: Minus 9000 Feet" },
  { num: 15, jmeno: "BATYSKAF", cHud: 7, dffr: 528773, dffs: 2341609, cz: "Batyskaf", en: "Bathyscaph" },
  { num: 16, jmeno: "SVATBA", cHud: 9, dffr: 932070, dffs: 2142701, cz: "Obojživelný tank", en: "Amphibious Tank" },
  { num: 17, jmeno: "DRAKAR", cHud: 5, dffr: 982225, dffs: 7870750, cz: "Osm vikingů a pes", en: "Eight Vikings in a Boat" },
  { num: 18, jmeno: "PARTY2", cHud: 15, dffr: 1057488, dffs: 1479145, cz: "Návrat z výletu", en: "Return from the Party" },
  { num: 19, jmeno: "LODE", cHud: 1, dffr: 1759674, dffs: 7317465, cz: "Bohové musí být šílení", en: "The Gods Must Be Mad" },
  { num: 20, jmeno: "ZDVIZ1", cHud: 1, dffr: 695577, dffs: 2063093, cz: "Dům s výtahem", en: "House with an Elevator" },
  { num: 21, jmeno: "VITEJTE1", cHud: 3, dffr: 647733, dffs: 6646516, cz: "Vítejte ve městě!", en: "Welcome To Our City" },
  { num: 22, jmeno: "UFO", cHud: 13, dffr: 771263, dffs: 2197955, cz: "Den nezávislosti", en: "Independence Day" },
  { num: 23, jmeno: "SLOUPY", cHud: 5, dffr: 962848, dffs: 1219897, cz: "Na kolonádě", en: "The Columns" },
  { num: 24, jmeno: "DIRY", cHud: 2, dffr: 918585, dffs: 3509014, cz: "Nerovná dlažba", en: "Uneven Pavement" },
  { num: 25, jmeno: "PYRAMIDA", cHud: 7, dffr: 666818, dffs: 1014514, cz: "Dům pana Cheopse", en: "Mr. Cheops` House" },
  { num: 26, jmeno: "VES", cHud: -1, dffr: 699637, dffs: 1543407, cz: "Pro potěšení", en: "A Bit of Music" },
  { num: 27, jmeno: "SECRET", cHud: 4, dffr: 767448, dffs: 2580707, cz: "Paniptikum korýšů", en: "Crab Freak Show" },
  { num: 28, jmeno: "ZDVIZ2", cHud: 1, dffr: 695587, dffs: 2211156, cz: "Druhý dům s výtahem", en: "Another elevator" },
  { num: 29, jmeno: "SPUNT", cHud: 14, dffr: 896491, dffs: 4043542, cz: "Tak takhle to bylo", en: "And How It Was" },
  { num: 30, jmeno: "RECYCLED", cHud: 14, dffr: 427310, dffs: 1452308, cz: "První bizarnosti", en: "First Bizarre Things" },
  { num: 31, jmeno: "BLUDISTE", cHud: 4, dffr: 887905, dffs: 2235919, cz: "Bludiště", en: "Labyrinth" },
  { num: 32, jmeno: "NCP", cHud: 3, dffr: 977211, dffs: 1052576, cz: "Uvězněni", en: "Imprisoned" },
  { num: 33, jmeno: "MIKRO", cHud: 1, dffr: 268110, dffs: 1792813, cz: "Uzavřená společnost", en: "Closed Society" },
  { num: 34, jmeno: "KORALY", cHud: -1, dffr: 831144, dffs: 3285408, cz: "Spící tvorečkové", en: "Sleeping Creatures" },
  { num: 35, jmeno: "KANKAN", cHud: 12, dffr: 846893, dffs: 73681, cz: "Kankánoví krabíci", en: "Cancan Crabs" },
  { num: 36, jmeno: "JEDNICKY", cHud: 4, dffr: 581467, dffs: 2003960, cz: "Ještě jednu perličku!", en: "One More Pearl; Please!" },
  { num: 37, jmeno: "ZELVA", cHud: 5, dffr: 1226620, dffs: 2651702, cz: "Telepatická mrcha", en: "Telepathic Devil" },
  { num: 38, jmeno: "POCITAC", cHud: 14, dffr: 563954, dffs: 2987424, cz: "Hlubinný server", en: "The Deep Server" },
  { num: 39, jmeno: "NOGROUND", cHud: 6, dffr: 297896, dffs: 459780, cz: "Skoro žádná zeď", en: "Almost No Wall" },
  { num: 40, jmeno: "BATHROOM", cHud: 2, dffr: 595914, dffs: 1930491, cz: "Instalatérský odpad", en: "Plumbman`s Refuse" },
  { num: 41, jmeno: "ODPADKY", cHud: 3, dffr: 354113, dffs: 1062577, cz: "Dobrodružství s kachničkou", en: "Adventure with Pink Duckie" },
  { num: 42, jmeno: "PUCLIK", cHud: 10, dffr: 1817439, dffs: 1381876, cz: "Rozstříhaná čmáranice", en: "Shredded Stickman" },
  { num: 43, jmeno: "SMETAK", cHud: 15, dffr: 761983, dffs: 2343286, cz: "Opravdový chaos", en: "Real Chaos" },
  { num: 44, jmeno: "BARELY", cHud: 5, dffr: 1607548, dffs: 4246188, cz: "Greenpeace by zuřili", en: "Outraged Greenpeace" },
  { num: 45, jmeno: "KAJUTA1", cHud: 4, dffr: 350352, dffs: 3029106, cz: "Kajuta prvního důstojníka", en: "The First Mate`s Cabin" },
  { num: 46, jmeno: "TRUP", cHud: 5, dffr: 387719, dffs: 802508, cz: "Zimní jídelna", en: "The Winter Mess Hall" },
  { num: 47, jmeno: "DELA", cHud: 6, dffr: 482410, dffs: 1089370, cz: "Pal!", en: "Fire!" },
  { num: 48, jmeno: "KUCHYNE", cHud: 1, dffr: 906687, dffs: 3438246, cz: "Lodní kuchyně", en: "Ship Kitchen" },
  { num: 49, jmeno: "KAJUTA2", cHud: 9, dffr: 428549, dffs: 2901125, cz: "Kajuta druhého důstojníka", en: "Second Mate`s Cabin" },
  { num: 50, jmeno: "VLADOVA", cHud: 15, dffr: 657347, dffs: 2034918, cz: "Kapitánova kajuta", en: "Captain`s Cabin" },
  { num: 51, jmeno: "MAPA", cHud: 6, dffr: 820823, dffs: 1844274, cz: "Silverova tajná skrýš", en: "Silver`s Hideout" },
  { num: 52, jmeno: "REAKTOR", cHud: 7, dffr: 801883, dffs: 2233394, cz: "Reaktor", en: "Power Plant" },
  { num: 53, jmeno: "PAPRSKY", cHud: 9, dffr: 640757, dffs: 2141461, cz: "Neznámé síly", en: "Strange Forces" },
  { num: 54, jmeno: "MOTOR", cHud: 13, dffr: 612092, dffs: 3304492, cz: "Brm brm...", en: "Brm... Brm..." },
  { num: 55, jmeno: "STEEL", cHud: -1, dffr: 1575437, dffs: 218747, cz: "Ocel; samá ocel", en: "Nothing but steel" },
  { num: 56, jmeno: "CHODBA", cHud: 2, dffr: 889812, dffs: 5522602, cz: "Přísně střežená chodba", en: "Guarded Corridor" },
  { num: 57, jmeno: "BANKA", cHud: 5, dffr: 1084330, dffs: 3014833, cz: "Biologické experimenty", en: "Biological Experiments" },
  { num: 58, jmeno: "POHON", cHud: 14, dffr: 1007507, dffs: 2668849, cz: "Skutečný pohon", en: "The Real Propulsion" },
  { num: 59, jmeno: "BOTTLES", cHud: 6, dffr: 1052993, dffs: 1645377, cz: "Sál aztéckého umění", en: "Azec Art Hall" },
  { num: 60, jmeno: "ZAVAL", cHud: 3, dffr: 325169, dffs: 1798453, cz: "Blýskavý zával", en: "Shiny Cave-in" },
  { num: 61, jmeno: "TRUHLA", cHud: 10, dffr: 759242, dffs: 2487284, cz: "Truhlička obra Koloděje", en: "Giant`s Chest" },
  { num: 62, jmeno: "KNIHOVNA", cHud: 7, dffr: 661227, dffs: 1668394, cz: "Alibabův sál", en: "The Hall of Ali-baba" },
  { num: 63, jmeno: "JESKYNE", cHud: 5, dffr: 538443, dffs: 2418102, cz: "Nejhlubší jeskyně", en: "The Deepest Cave" },
  { num: 64, jmeno: "GRAL", cHud: 4, dffr: 935403, dffs: 2266704, cz: "Artuš by se divil", en: "What Would King Arthur Say?" },
  { num: 65, jmeno: "TETRIS", cHud: 7, dffr: 865558, dffs: 1723090, cz: "TETRIS", en: "TETRIS" },
  { num: 66, jmeno: "ZX", cHud: -1, dffr: 914176, dffs: 2059569, cz: "Emulátor", en: "Emulator" },
  { num: 67, jmeno: "WARCR2", cHud: 9, dffr: 989793, dffs: 2930286, cz: "Garden of War", en: "Garden of War" },
  { num: 68, jmeno: "WIN", cHud: 13, dffr: 1074741, dffs: 3866937, cz: "Oblíbené položky", en: "Favorites" },
  { num: 69, jmeno: "PUZZLE", cHud: 3, dffr: 650858, dffs: 1749410, cz: "Hardwarový problém", en: "A Hardware Problem" },
  { num: 70, jmeno: "DISKETA", cHud: 15, dffr: 952435, dffs: 3495876, cz: "Read only", en: "Read Only" },
  { num: 71, jmeno: "ZAVER", cHud: 4, dffr: 461535, dffs: 3380638, cz: "Doma", en: "At Home" },
  { num: 72, jmeno: "SCORE", cHud: 13, dffr: 693284, dffs: 1438390, cz: "Special Score", en: "Special Score" },
];

/** Look up a room by its 1-based number (1..72). */
export function roomByNumber(num: number): RoomDesc | undefined {
  return ROOMS[num - 1];
}

/** Look up a room by its (case-insensitive) Jmeno. */
export function roomByName(name: string): RoomDesc | undefined {
  const n = name.toUpperCase();
  return ROOMS.find((r) => r.jmeno.toUpperCase() === n);
}
