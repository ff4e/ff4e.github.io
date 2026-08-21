/**
 * The help pages, as text.
 *
 * The original showed twenty 640x480 bitmaps (`public/data/Help/help01..10[e].BMP`,
 * listed by `helpy.txt`/`helps.txt`, Help.pas:FormShow). Six of the ten pages are pure
 * text and four carry diagrams; this module is the ten pages transcribed, in both
 * languages, with the diagrams referenced by the ids `tools/crop-help-diagrams.ts` writes.
 *
 * The bitmaps are NOT deleted — `public/data/` is the ALTAR release byte for byte and
 * stays that way (`public/restored/README.md`). They are simply no longer what the game
 * shows, and `tools/stage-pages-assets.mjs` stops publishing them.
 *
 * ── This text is quoted, not written ──────────────────────────────────────────
 * Every string below is ALTAR's, transcribed from the bitmap named in `source`. The port's
 * premise is that the original wins, so it is reproduced verbatim — **including its
 * mistakes**. Do not "fix" these; each one was checked against the bitmap at 4x:
 *
 *   - cz p2  "že jdeš srávnou cestou"                (for `správnou`)
 *   - cz p4  "spočívá přímo a pouze na rybce.."      (two full stops)
 *   - cz p7  "po jiné rybičce  stejně"               (two spaces)
 *   - cz p7  "na obrázku nahoře vpravo"              (no full stop)
 *   - cz p8  "na obrázku vlevo a uprostřed"          (no full stop)
 *   - cz p9  "kdy je je jeho řešení nejefektivnější" (`je` twice)
 *   - cz p10 "a svěřepě odmítala"                    (for `svéřepě`)
 *   - en p2  "After running the leve the control panel appears" / "th current level"
 *   - en p3  "but is certainly an option"            (missing `it`)
 *   - en p7  "the Lshaped object"                    (no hyphen)
 *   - en p9  "better tha n the previous one"         (space inside `than`)
 *   - en p10 "Another titles" / "that is really makes difference" / "Find our more"
 *
 * Runs of whitespace inside a paragraph are the one thing normalised to a single space:
 * they are a artefact of the original's manual line breaking, HTML collapses them anyway,
 * and `test/helpText.test.ts` pins that they are gone. The two deliberate ones above are
 * called out because they are quoted here in prose, not because they survive in the data.
 *
 * ── The dead addresses ────────────────────────────────────────────────────────
 * The URLs and the e-mail are 1998-2003 and none of them answers. They are reproduced
 * verbatim, as text rather than as links (`kind: 'url'`), because pretending a dead
 * address still works is worse than showing what the original said. Each language's last
 * page carries one present-day line — the only sentence in this file that is not ALTAR's,
 * and marked `kind: 'today'` so it can never be mistaken for theirs.
 */

export type HelpLang = 'cz' | 'en';

/**
 * One piece of a page. Deliberately a small closed set: the original's pages are four
 * different compositions, not one template, and a block list reproduces them without a
 * per-page renderer.
 *
 * `text` may carry `*emphasis*` between asterisks — the original italicises a few phrases
 * mid-sentence (`drž stisknuté`, `press and hold`). Nothing else is markup.
 */
export type HelpBlock =
  /** The FILLETS wordmark and its tagline (page 1 only). */
  | { kind: 'logo'; tagline: string }
  /** The page's centred title. Only pages 2 and 4 have one. */
  | { kind: 'title'; text: string }
  /** A bold sub-heading within the page. */
  | { kind: 'heading'; text: string }
  /** A large centred line — `Dobře se bav!`, `Soutěž` (page 9). */
  | { kind: 'display'; text: string }
  /** Body text. `indent` marks the original's first-line indent, which starts a new thought. */
  | { kind: 'para'; text: string; indent?: true }
  /** The indented block of movement rules on page 4. */
  | { kind: 'rule'; text: string }
  /** An italic aside — the continued-on/continued-from notes on pages 7 and 8. */
  | { kind: 'note'; text: string; align?: 'right' }
  /** A bulleted list (English page 10 only). */
  | { kind: 'list'; items: string[] }
  /** A row of framed diagrams across the page. */
  | { kind: 'figures'; ids: string[] }
  /** The small steel-cylinder picture that sits beside the text on page 6. */
  | { kind: 'inlineFigure'; id: string; alt: string }
  /** A dead 1998-2003 address, shown as text and never as a link. See the header. */
  | { kind: 'url'; text: string }
  /** The one present-day line per language. Not ALTAR's words. See the header. */
  | { kind: 'today'; text: string }
  /** The copyright block at the foot of page 1. */
  | { kind: 'footer'; lines: string[] };

export interface HelpPageContent {
  /** The tab name from the index file (Help.pas:FormShow), kept as the page's label. */
  tab: string;
  /** The bitmap this page was transcribed from — the audit trail for every string in it. */
  source: string;
  /** Two diagrams pinned in a left column beside the text (page 6 only). */
  column?: string[];
  blocks: HelpBlock[];
}

const CZ: HelpPageContent[] = [
  {
    tab: 'Úvod',
    source: 'help01.BMP',
    blocks: [
      { kind: 'logo', tagline: '. . . víc než RYBÍ MASO' },
      {
        kind: 'para',
        text: 'Na dalších stránkách se dozvíš, jak svoje rybičky ovládat, na co si s nimi dávat pozor a co jim škodí. Také jsou tu popsána pravidla doprovodné soutěže.',
      },
      { kind: 'footer', lines: ['(C) 1998 Altar interactive, s.r.o.', 'http://www.altarinteractive.com'] },
    ],
  },
  {
    tab: 'Ovládání 1/2',
    source: 'help02.BMP',
    blocks: [
      { kind: 'title', text: 'Ovládání' },
      { kind: 'heading', text: 'Spouštění místnosti' },
      {
        kind: 'para',
        text: 'Po startu hry se objeví mapa podmořského království, do které je zakreslena jedna nebo více cest. Na nich jsou vyznačeny místnosti, které jsi už vyřešil (zlaté kuličky), místnosti, které na řešení čekají (pulsující modré kuličky) a místnosti, do nichž jsi ještě nevstoupil (prázdné důlky).',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Místnosti je možné řešit jenom postupně, to znamená, že na dané cestě není možné řešit žádnou místnost za blikající kuličkou. Teprve když ji vyřešíš, rozbliká se ta za ní a tak dále.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Blikající místnost můžeš spustit kliknutím levým tlačítkem. Pokud klikneš na místnost, kterou jsi už vyřešil, objeví se statistika tvého řešení – počet tahů – a nabídnou se ti dvě možnosti: řešit znovu (ikona mozku) a prohlížet řešení (ikona oka).',
      },
      { kind: 'heading', text: 'Ovládací panel' },
      {
        kind: 'para',
        text: 'Po spuštění místnosti se objeví ovládací panel. Na něm vidíš, která ryba je právě aktivní, a jak ji ovládat. Kromě toho zde máš možnost uložit pozici (save), nahrát pozici (load), zrušit hru (abort) a začít řešit danou místnost od začátku (restart).',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Při ukládání pozice měj na paměti, že tím přemažeš předešlou uloženou pozici v daném levelu. Proto ukládej jen tehdy, když máš jistotu, že jdeš srávnou cestou.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Na druhé straně ovládacího panelu jsou různé options – hlasitost hudby, zvláštních efektů a řeči, můžeš si vybrat, jestli chceš vidět titulky a zda mají být česky nebo anglicky.',
      },
    ],
  },
  {
    tab: ' 2/2',
    source: 'help03.BMP',
    blocks: [
      { kind: 'heading', text: 'Pohyb' },
      { kind: 'para', text: 'Svoje rybičky můžeš ovládat čtyřmi různými způsoby:' },
      { kind: 'heading', text: '1. Kurzorovými klávesami' },
      {
        kind: 'para',
        text: 'Klávesami nahoru, dolů, doprava a doleva ovládáš aktivní rybku. Mezerníkem se můžeš mezi rybkami přepínat. Na ovládacím panelu vidíš, která ryba je právě aktivní.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Pokud se ti zdá, že ryba na tvoje pokyny nereaguje, pravděpodobně se snažíš odsunout něco, co není volně upevněný předmět, nebo se snažíš malou rybičkou posunout ocelový předmět.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Budeš-li držet kurzorovou klávesu stisknutou, pohyb rybičky se asi po třech polích zrychlí.',
      },
      { kind: 'heading', text: '2. Myší' },
      {
        kind: 'para',
        text: 'Ukaž kurzorem myši na místo, kam chceš s rybkou dojet, stiskni a *drž stisknuté* levé tlačítko myši. Pokud tam rybka může dojet, aniž by něčím pohnula, vydá se na cestu. Asi po třech polích se její pohyb zrychlí.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Pokud chceš nějakým předmětem pohnout, stiskni a *drž stisknuté* pravé tlačítko myši. Aktivní rybka se pohne nejkratší možnou cestou k místu, kam jsi ukázal.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Mezi rybami se můžeš přepínat prostě tak, že na rybu, kterou chceš aktivovat, klikneš levým tlačítkem.',
      },
      { kind: 'heading', text: '3. Přímo' },
      {
        kind: 'para',
        text: 'Klávesami A, S, D a W můžeš ovládat malou rybičku a klávesami J, K, L a I velkou rybku – to je napsáno i na ovládacím panelu. Toto ovládání má jedinou výhodu – nemusíš se přepínat mezi rybkami.',
      },
      { kind: 'heading', text: '4. Pomocí ovládacího panelu.' },
      {
        kind: 'para',
        text: 'Místo kurzorovými klávesami můžeš rybičky ovládat i klikáním na příslušné ikony na ovládacím panelu. Těžko si tedy dovedeme představit, že by to někomu k něčemu bylo, ale možnost to je.',
      },
    ],
  },
  {
    tab: 'Principy hry',
    source: 'help04.BMP',
    blocks: [
      { kind: 'title', text: 'Principy hry' },
      { kind: 'heading', text: 'Cíl hry' },
      {
        kind: 'para',
        text: 'V naprosté většině místnosti je tvým cílem dostat obě rybičky ven. Abys toho dosáhl, musíš různě přerovnat a přeskupit předměty v místnosti. Při tom je třeba dbát velké opatrnosti, neboť rybičky jsou stvoření křehká a je snadno je zahubit. Viz také Pravidla pro pohyb.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Cílem hry je vyřešit všechny místnosti ve hře, kterých je celkem sedmdesát. Pokud je vyřešíš rychle, můžeš vyhrát soutěž pro nejlepšího řešitele – viz Soutěž.',
      },
      { kind: 'heading', text: 'Pravidla pro pohyb' },
      {
        kind: 'para',
        text: 'Zvláště ze začátku se ti bude zdát, že tvoje rybičky hynou ze zcela nepochopitelných důvodů. Zde popíšeme pravidla, kterými se život rybiček řídí.',
      },
      { kind: 'para', indent: true, text: 'Definice dovoleného pohybu zní takto:' },
      {
        kind: 'rule',
        text: 'Velká rybka zahyne, pokud se nějaký předmět pohne jiným směrem než vzhůru a tento předmět ve své nové pozici spočívá přímo a pouze na rybce..',
      },
      {
        kind: 'rule',
        text: 'Velká rybka také zahyne, pokud se nějaký předmět pohne dolů a ve své nové pozici spočívá pouze na předmětu nebo skupině předmětů, které spočívají přímo a pouze na rybce.',
      },
      {
        kind: 'rule',
        text: 'Malá rybička zahyne ve všech případech, kdy by zahynula velká rybka. Navíc také zahyne v případě, že se dostane do situace, kdy pouze na ní spočívá ocelový předmět nebo skupina předmětů, která obsahuje ocelový předmět.',
      },
      { kind: 'para', text: 'Co to vlastně znamená, je vysvětleno na následujících stranách:' },
    ],
  },
  {
    tab: 'Bezpečný pohyb 1/5',
    source: 'help05.BMP',
    blocks: [
      { kind: 'heading', text: '1. Posun předmětů' },
      {
        kind: 'para',
        text: 'Rybičkám hrozí nebezpečí jen tehdy, když nějakým předmětem hýbou. Nejjednodušší situace nastává, když jedna rybička předmět zdvihá – v takovém případě jí žádné nebezpečí nehrozí. Pokud v situaci na obrázku vlevo jde rybička nahoru, zdvihá sebou předmět. Jde-li doprava nebo doleva, nic se jí nestane, ale předmět zůstává na místě. Půjde-li doleva nebo doprava dost dlouho, nakonec zpod něj vyjede a předmět spadne na zem a nijak jí neublíží. Jediný směr, který pro ni znamená smrt, je pohyb dolů. V takovém případě na ni vlastně předmět, který dosud podpírala, spadne.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Jestliže rybička před sebou nějaký předmět tlačí, musí ho mít položený na nějaké podložce. Kdyby držela ve vzduchu (vlastně ve vodě) předmět vhodného tvaru k tlačení jako na obrázku uprostřed, stejně ho nemůže posunout, tj. v tomto případě se nesmí pohnout vlevo. Jinak pro ni platí to samé jak v minulé situaci.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Rybička může předmět, který se o nic neopírá, posunout jen tehdy, když se o něco opře v nové pozici, jako třeba na obrázku vpravo.',
      },
      { kind: 'figures', ids: ['fig-05-1', 'fig-05-2', 'fig-05-3'] },
    ],
  },
  {
    tab: ' 2/5',
    source: 'help06.BMP',
    column: ['fig-06-1', 'fig-06-2'],
    blocks: [
      { kind: 'heading', text: '1.1 Těžké předměty' },
      { kind: 'inlineFigure', id: 'fig-06-steel', alt: 'Ocelový válec' },
      {
        kind: 'para',
        text: 'Ve hře občas narazíš na tzv. těžké neboli ocelové předměty. Jsou to různé válce, které vypadají jako předmět vedle. Těžké předměty může zdvihat a posunovat jen velká ryba. Malá rybička s nimi nepohne a pokud se někdy dostane pod ně, zahyne i v situaci, kterou by normálně (kdyby se nejednalo o těžký předmět) přežila.',
      },
      { kind: 'heading', text: '2. Předávání předmětů' },
      {
        kind: 'para',
        text: 'Rybičky si mohou předměty předávat. Když jedna rybička předmět podpírá a druhá rybička najede do pozice, kdy předmět spočívá i na ní, může první rybička zase odjet. Na obrázku nahoře může odjet kterákoliv z rybek a předmět zůstane ležet na zbývající.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Pozor na předávání těžkých předmětů. V situaci na obrázku dole může odjet jen malá rybička.',
      },
    ],
  },
  {
    tab: ' 3/5',
    source: 'help07.BMP',
    blocks: [
      { kind: 'heading', text: '3. Posunování po jiných předmětech' },
      {
        kind: 'para',
        text: 'Oblíbeným trikem tvůrců místností jsou situace, kdy se přesunuje předmět po předmětu, který leží na rybičce. To je možné a je to vidět na obrázku vlevo.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Není ovšem možné posunovat předmět po jiné rybičce stejně, jako rybička sama nemůže tlačit předmět, který se o nic neopírá. Na obrázku uprostřed nemůže malá rybička zatlačit, protože by posunula i spodní předmět a tím by velkou rybku zabila. Mohla by ovšem zatlačit na předmět ve tvaru L z druhé strany.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Stejně tak není možné na rybičku přesunout předmět, který se dosud opíral o konstrukci, jak to vidíme na obrázku nahoře vpravo',
      },
      { kind: 'note', align: 'right', text: '(Dokončení na další straně)' },
      { kind: 'figures', ids: ['fig-07-1', 'fig-07-2', 'fig-07-3'] },
    ],
  },
  {
    tab: ' 4/5',
    source: 'help08.BMP',
    blocks: [
      { kind: 'note', text: '(Posunování po jiných předmětech – dokončení)' },
      {
        kind: 'para',
        indent: true,
        text: 'Jediné případy, kdy je možné předmět po rybičce posunout, jsou situace, kdy předmět buď hned spadne nebo se opře o podklad. To je vidět na obrázku vlevo a uprostřed',
      },
      { kind: 'heading', text: '4. Shazování předmětů' },
      {
        kind: 'para',
        text: 'Shazování předmětů je vždycky smrtelné. Nezáleží na tom, co shodíte nebo z jaké výšky; pokud předmět dopadne na rybičku nebo na něco, co se o rybičku opírá, znamená to pro ni smrt.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Dávej si pozor na situace, kdy předmět sice spadne „na rybičku“ ale ve skutečnosti dopadne na nějaký pevný podklad. V takovém případě je rybička v bezpečí, i když to tak na první pohled nevypadá. Příklad takové situace je na obrázku vpravo.',
      },
      { kind: 'figures', ids: ['fig-08-1', 'fig-08-2', 'fig-08-3'] },
    ],
  },
  {
    tab: ' 5/5',
    source: 'help09.BMP',
    blocks: [
      { kind: 'heading', text: '5. Animované předměty' },
      {
        kind: 'para',
        text: 'Některé předměty ve hře jsou animované: chobotnice hraje na balalajku, sasynky tančí, Vikinkové si povídají a tak dále. To všechno je tu jen proto, aby ses při řešení místností nenudil. Nic z toho nemá význam pro řešení logických problémů. Ve skutečnosti jsou ve hře jen dva druhy objektů: obyčejné a těžké. Nezávisle na tom, jak vypadá, zaujímá určité množství elementárních čtverečků a to je jediná důležitá informace o každém předmětu.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Nepokoušej se dotlačit pokličku na hrnec, rozbít sklenice, spojit magnety – nic v místnosti se nezmění. Můžeš se dočkat nějaké pěkné animace (takže si to radši přece jen zkus), ale tvar ani rozložení předmětů to neovlivní (takže se tím nezdržuj, pokud hraješ závodně).',
      },
      { kind: 'display', text: 'Dobře se bav!' },
      { kind: 'display', text: 'Soutěž' },
      {
        kind: 'para',
        text: 'Soutěž o nejkratší řešení nemá žádného trvalého vítěze. Po vyřešení poslední místnosti ti program také řekne, kolik tahů má tvoje řešení (tah je každý pohyb rybičky; kdybys je ovládal z klávesnice, je to každé stisknutí klávesy). Pohledem na naši webovou stránku nebo dotazem můžeš zjistit, zda jsi rekord překonal nebo ne. Když budeš hrát nějakou místnost znovu a svoje řešení zlepšíš, program ti to také oznámí. Vítěz v této soutěži dostane zdarma všechny produkty ALTARu, které vyjdou v době, kdy je je jeho řešení nejefektivnější.',
      },
    ],
  },
  {
    tab: 'Altar',
    source: 'help10.BMP',
    blocks: [
      { kind: 'heading', text: 'Mezi další tituly ALTAR interactive patří:' },
      { kind: 'heading', text: 'Original War (vyšlo 2001, v edici Game4U 2002)' },
      {
        kind: 'para',
        text: 'Realtimová strategie Original War má nelineární rozvětvenou zápletku, která je důležitou součástí hry. Cíle mise vyplývají z příběhu hry a jejich splnění či naopak nesplnění může ovlivnit další vývoj hry.',
      },
      {
        kind: 'para',
        text: 'Na začátku mise máte pouze omezený počet lidí a nemůžete čekat žádné posily nebo si je dokonce vyrábět. Lidé přitom musí řídit vozidla, sbírat materiál, obsluhovat továrny a vynalézat nové technologie. Každý z nich je jedinečná osobnost s vlastním jménem, tváří, souborem dovedností a vlastností, které se mohou během hry zlepšovat.',
      },
      { kind: 'para', text: 'Vyzkoušejte si demo Original War na adrese' },
      { kind: 'url', text: 'http://www.original-war.com' },
      { kind: 'para', text: 'nebo si objednejte plnou verzi na (X)zone' },
      { kind: 'url', text: 'http://www.xzone.cz/' },
      { kind: 'heading', text: 'UFO: Aftermath (vyjde 2003)' },
      {
        kind: 'para',
        text: 'Na orbitu naší planety se objevila gigantická vesmírná loď. Tiše kroužila vesmírem a svěřepě odmítala všechny pokusy o komunikaci. Nedlouho poté do atmosféry vypustila oblaka spór, které se začaly množit neuvěřitelnou rychlostí, až zakryly sluneční světlo. Toto období temna bude později nazýváno „Soumrak“.',
      },
      {
        kind: 'para',
        text: 'Po nekonečných dnech obav se spóry snesly na Zemi, zaplavily ulice, přehradily vodní toky a udusily téměř vše živé. Nikdo se nestačil připravit na tak rychlý zánik naší civilizace a jen málo lidí se stačilo schovat do podzemí. Po několika týdnech se spóry rozpadly a zničený svět opět vypadá bezpečně. Alespoň na chvíli.',
      },
      { kind: 'para', text: 'Více se o UFO: Aftermath dozvíte na oficiální stránce' },
      { kind: 'url', text: 'http://www.ufo-aftermath.com' },
      { kind: 'para', text: 'nebo na české fan stránce' },
      { kind: 'url', text: 'http://aftermath.doupe.cz/' },
      {
        kind: 'today',
        text: 'ALTAR interactive už neexistuje a žádná z adres na této stránce neodpovídá. Pokud chceš něco vzkázat téhle prohlížečové verzi hry, použij Send feedback pod panelem Options.',
      },
    ],
  },
];

const EN: HelpPageContent[] = [
  {
    tab: 'Intro',
    source: 'help01e.BMP',
    blocks: [
      { kind: 'logo', tagline: '...more than the FISH MEAT' },
      {
        kind: 'para',
        text: 'The next pages will show you how to control your fish, what you can do with them and what is harmful.',
      },
      { kind: 'footer', lines: ['(C) 1998 Altar interactive, s.r.o.', 'http://www.altarinteractive.com'] },
    ],
  },
  {
    tab: 'Controls 1/2',
    source: 'help02e.BMP',
    blocks: [
      { kind: 'title', text: 'Control' },
      { kind: 'heading', text: 'Running a level' },
      {
        kind: 'para',
        text: 'When the game starts a map of under water kingdom appears on your screen with one or more paths. It shows the already solved levels (golden beads), levels that are being solved (pulsating blue beads) and as yet unentered levels (empty sockets).',
      },
      {
        kind: 'para',
        indent: true,
        text: 'It is only possible to solve the levels one by one. It means that you cannot enter any level behind the blinking bead. Only when you solve it the next bead starts pulsating and so on.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Pulsating level can be run by left-clicking the bead. If you left-click an already solved level, statistics – the number of moves – of your solution appears. You have two options now: solve it again (click the brain icon) or watch the solution (eye icon).',
      },
      { kind: 'heading', text: 'Control panel' },
      {
        kind: 'para',
        text: 'After running the leve the control panel appears. It shows which fish is currently active and how to control it. Besides that you can use the control panel to save or load the game and abort or restart th current level.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'When saving the solution you must keep in mind that there is only one slot for load and save for each level. When saving new position the older one is erased without asking for confirmation. It is recommended that you save new position only when you are sure that you are going in the right direction.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Different options are on the second page of the control panel. You can control the volume of sound, speech and F/X, you can choose the language of subtitles or turn them off altogether.',
      },
    ],
  },
  {
    tab: ' 2/2',
    source: 'help03e.BMP',
    blocks: [
      { kind: 'heading', text: 'Movement' },
      { kind: 'para', text: 'You can control your fish in one of four ways:' },
      { kind: 'heading', text: '1. Arrow keys' },
      {
        kind: 'para',
        text: 'Up, down, left and right arrow keys control the current fish. You can use space bar to switch between the fish. The control panel shows which fish is currently active.',
      },
      {
        kind: 'para',
        indent: true,
        text: "When the fish doesn't move although you are pressing the keys, you are probably trying to push something that cannot be moved or you are trying to push the steel object with the smaller fish.",
      },
      {
        kind: 'para',
        indent: true,
        text: 'If you press and hold the arrow key, the fish movement will accelerate after approx. 3 spaces.',
      },
      { kind: 'heading', text: '2. Mouse' },
      {
        kind: 'para',
        text: 'Point the mouse cursor at the place where you want your fish to go, *press and hold* the left mouse button. If the fish can get to this place, it starts moving. Its movement will accelerate after approx. three spaces.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'If you want to move something, *press and hold* the right mouse button. The currently selected fish will try to move directly to the spot where you clicked, pushing aside everything in its way.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'You can switch between fish simply by left-clicking the one you want to activate.',
      },
      { kind: 'heading', text: '3. Direct control' },
      {
        kind: 'para',
        text: 'Keys A, S, D and W control the smaller fish and keys J, K, L and I the bigger fish – these keys are also given on the control panel. The only advantage of this control is that you need not to switch between the fish.',
      },
      { kind: 'heading', text: '4. The Control Panel' },
      {
        kind: 'para',
        text: 'You can also control the fish by clicking the respective icons on the control panel. We can hardly imagine a situation when there would be any point in doing so, but is certainly an option.',
      },
    ],
  },
  {
    tab: 'About the Game',
    source: 'help04e.BMP',
    blocks: [
      { kind: 'title', text: 'About the Game' },
      { kind: 'heading', text: 'Your goal' },
      {
        kind: 'para',
        text: 'Your goal in most of the rooms to get both fish out. To do this you have to move around and rearrange various objects in the room. You have to be very careful because they are quite fragile and it is all too easy to kill them. See also the Movement rules.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'The goal of the game is to solve all seventy levels. If you manage to do it quickly you can win the race for the earliest solution – see also Competition.',
      },
      { kind: 'heading', text: 'Movement rules' },
      {
        kind: 'para',
        text: 'When you start to play the game your fish will perish from time to time from seemingly no reason at all. Here we shall state the general rules governing the life of your fish.',
      },
      { kind: 'note', text: 'The Definition:' },
      {
        kind: 'rule',
        text: 'The Greater Fish will perish if any object moves in any direction but up and the said object in its new position rests solely upon the Fish.',
      },
      {
        kind: 'rule',
        text: 'The Greater Fish will also perish if any object moves down and in its new position rests solely upon the object or group of objects resting solely upon the Fish.',
      },
      {
        kind: 'rule',
        text: 'The Smaller Fish will perish in all cases where the Greater Fish would. Moreover, it will always perish if a steel object or a group of objects containing a steel object rests solely upon the Fish.',
      },
      { kind: 'para', text: 'The next pages will tell you what does it in fact mean;' },
    ],
  },
  {
    tab: 'Safe Movement 1/5',
    source: 'help05e.BMP',
    blocks: [
      { kind: 'heading', text: '1. Pushing objects' },
      {
        kind: 'para',
        text: 'The fish are only in danger when they move some object. The simplest situation is lifting objects – there is no danger in it. If the fish on the left picture moves up, it lifts the object. If it moves left or right, nothing happens, but the object stays in place; if it goes on moving left or right long enough, it will eventually come out from under the object and the object will fall harmlessly down. The only dangerous direction is down. If the fish moves down, the object it was supporting will fall on it and kill it.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'If the fish want to push an object, the object must be supported by some structure or other object. The fish cannot support the object it is pushing. The fish on the middle picture cannot move left because it would get killed.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'The fish can push an unsupported object only if it becomes supported in the new position. An example of such a situation is on the right picture.',
      },
      { kind: 'figures', ids: ['fig-05-1', 'fig-05-2', 'fig-05-3'] },
    ],
  },
  {
    tab: ' 2/5',
    source: 'help06e.BMP',
    column: ['fig-06-1', 'fig-06-2'],
    blocks: [
      { kind: 'heading', text: '1.1 Steel object' },
      { kind: 'inlineFigure', id: 'fig-06-steel', alt: 'A steel cylinder' },
      {
        kind: 'para',
        text: 'In some levels you will note the steel objects. They look like the cylinder on this picture. Steel objects can only be lifted and pushed by the big fish. The smaller fish cannot move them and if it gets itself under a steel object, it will perish even if it would be harmless with other objects.',
      },
      { kind: 'heading', text: '2. Transferring objects' },
      {
        kind: 'para',
        text: 'The fish can transfer objects between themselves. If one fish supports the object and the other one gets into position where the object rests also upon her, the first fish can move away. Any fish can move away in the upper picture and the object will stay upon the other.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'Be careful with transfer of steel objects. In the situation on the lower picture only the smaller fish can move away.',
      },
    ],
  },
  {
    tab: ' 3/5',
    source: 'help07e.BMP',
    blocks: [
      { kind: 'heading', text: '3. Pushing along other objects' },
      {
        kind: 'para',
        text: 'The level designers favorite trick is a fish pushing an object supported not by the other fish (which is impossible) but by some object resting upon the other fish. This is indeed possible and it is presented on the left picture.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'However, you have to be careful never to move the object resting directly upon a fish. The smaller fish on the middle picture cannot push because it would kill the bigger fish. It could only push the Lshaped object from the other side.',
      },
      {
        kind: 'para',
        indent: true,
        text: 'It is also impossible to place an object upon a fish. This is shown on the right picture.',
      },
      { kind: 'note', align: 'right', text: '(Continued on the next page)' },
      { kind: 'figures', ids: ['fig-07-1', 'fig-07-2', 'fig-07-3'] },
    ],
  },
  {
    tab: ' 4/5',
    source: 'help08e.BMP',
    blocks: [
      { kind: 'note', text: '(Pushing along other objects – continued)' },
      {
        kind: 'para',
        indent: true,
        text: 'The object supported directly by a fish can only be pushed if it falls down or rests upon some structure immediately afterwards. This is shown on the left and middle pictures.',
      },
      { kind: 'heading', text: '4. Falling objects' },
      {
        kind: 'para',
        text: "Falling objects are always deadly. It doesn't matter how long the object falls; if it hits a fish or something that rests upon a fish, the fish is dead.",
      },
      {
        kind: 'para',
        indent: true,
        text: 'Be on the lookout for the situation where the object seemingly hits the fish but in fact it hits some structure. In such a situation the fish is safe though it may not look like this at all. An example of such situation is on the right picture.',
      },
      { kind: 'figures', ids: ['fig-08-1', 'fig-08-2', 'fig-08-3'] },
    ],
  },
  {
    tab: ' 5/5',
    source: 'help09e.BMP',
    blocks: [
      { kind: 'heading', text: '5. Animated object' },
      {
        kind: 'para',
        text: "Some objects in the game are animated – an octopus playing balalaika, dancing anemones, Vikings speaking to each other etc. All such stuff is here to make the game more lively. Everything is completely irrelevant to the solution. There are only two kinds of objects in the game: normal and steel ones. No object interacts with any other object. It doesn't matter what the object looks like – all of them occupy some number of elementary squares and that is the only important thing about them.",
      },
      { kind: 'display', text: 'HAVE FUN!' },
      { kind: 'display', text: 'Contest' },
      {
        kind: 'para',
        text: 'The contest for shortest solution has no permanent winners. After solving the last level, the program will tell you how many moves your solution has. By looking at our web page you can find out if you matched the current shortest solution or not. If you replay any of already solved levels and your new solution is better tha n the previous one, the program will let you know, too.',
      },
    ],
  },
  {
    tab: 'Altar',
    source: 'help10e.BMP',
    blocks: [
      { kind: 'heading', text: 'Another titles from ALTAR interactive:' },
      { kind: 'heading', text: 'Original War (2001 Europe, 2002 USA)' },
      {
        kind: 'para',
        text: 'Real time strategy Original War offers nonlinear, multi-branching plot that is really makes difference throughout the game. The single most important thing in our game are people. You only have a fixed number of human units and at the same time, people are requisite to driving vehicles, collecting material, operating factories and researching new technologies. People are therefore your most precious resource: each of them is an individual with his own name and face and set of skills and attributes that can improve during the campaign.',
      },
      { kind: 'para', text: 'Find our more about this game at' },
      { kind: 'url', text: 'http://www.original-war.com/' },
      { kind: 'para', text: 'or buy it at Ebgames' },
      { kind: 'url', text: 'http://www.ebgames.com/' },
      { kind: 'heading', text: 'UFO: Aftermath (ETA 2003)' },
      {
        kind: 'para',
        text: "In UFO: Aftermath, a new strategy game from ALTAR interactive, you assume the role of the Earth's last hope, the commander of the last, scattered humans left on the planet. It is up to you guide your forces through the planet's time of crisis, and overcome the alien threat.",
      },
      { kind: 'para', text: 'Gameplay highlights include:' },
      {
        kind: 'list',
        items: [
          'Simultaneous turn-based combat: combines the best of the real-time and turn-based combat systems;',
          'Randomly generated tactical missions: Each playing field is unique, no two games are the same;',
          'Strong RPG elements: your soldiers will improve as they gain more experience, allowing you to make specialists like snipers, medics, and many more;',
          'Intricate, rich, and frighteningly alien setting displayed in full 3D.',
        ],
      },
      { kind: 'para', text: 'More information, newsletter and forum you can find at' },
      { kind: 'url', text: 'http://www.ufo-aftermath.com' },
      {
        kind: 'today',
        text: 'ALTAR interactive is gone and none of the addresses on this page answers any more. To say something to this browser port of the game, use Send feedback under the Options panel.',
      },
    ],
  },
];

/** The ten help pages for a language, in the index file's order. */
export function helpPages(lang: HelpLang): HelpPageContent[] {
  return lang === 'cz' ? CZ : EN;
}

/** Every figure id referenced by either language — the set `public/help/` must hold. */
export function helpFigureIds(): string[] {
  const ids = new Set<string>();
  for (const pages of [CZ, EN]) {
    for (const page of pages) {
      for (const id of page.column ?? []) ids.add(id);
      for (const b of page.blocks) {
        if (b.kind === 'figures') for (const id of b.ids) ids.add(id);
        else if (b.kind === 'inlineFigure') ids.add(b.id);
      }
    }
  }
  return [...ids];
}
