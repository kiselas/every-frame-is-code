# Lyapunov: script

A 50-second vertical film (Reels, Shorts, TikTok) about the Soviet mathematician Alexey Lyapunov, made for his birthday, 8 October. It is the worked example for [19-vertical.md](../../19-vertical.md). Source: [film.html](film.html). Render: `node render/render.mjs examples/lyapunov/film.html examples/lyapunov/lyapunov.mp4 --loudnorm`. The text on screen is in Russian; this file is in English, with the on-screen lines quoted.

## Specs

| | |
|---|---|
| Length | 50.0 s, 11 shots, 25 bars at 120 BPM |
| Frame | 1080×1920, 30 fps; `safe: [.07, .17, .22]` (sides, top, bottom) |
| Themes | `paper` (people, labels, institutions: warm off-white, ink, a stamp red, and a green for "science") and `blueprint` (the technical idea: cyanotype blue, white lines, one orange accent) |
| Type | Oswald 700 (condensed, so a 940 px line holds 16 capitals at the default size) for statements; IBM Plex Mono for captions, numbers and the HUD. Both have Cyrillic; Archivo, the kit's default, does not |
| Music | `Compose.generate`, A minor, `tense`, seed 5, one section per shot group, lint 98.5/100; effects on the same clock (stamp impacts, a riser into the reveal, a printer ticking out code lines) |

## Meaning

- **Thesis.** A word was branded a pseudoscience, and a mathematician who first taught the country to draw programs as schemes used the same patience to give the word back its science.
- **Hook question.** "In 1954 the word *cybernetics* was a verdict." A rubber stamp, `ЛЖЕНАУКА` (pseudoscience), lands on a dictionary page in the first 1.5 s. The question that follows: who undid it?
- **Spine.** Myth vs fact, with a how-it-works middle: the label → the man → the idea (a scheme of operators, then a program that assembles itself) → the fight for the name → the school he left behind → the label peels off.
- **Through-line.** The HUD is one life on a timeline, 1911 to 1973, with a year counter that rewinds (1954 → 1911) and then marches. The motif is the stamp: `ЛЖЕНАУКА` lands (shot 1), is struck out and replaced by `НАУКА` (shot 9), and dissolves (shot 11).
- **Bookend.** The last shot is the first shot's dictionary page, now with a scheme running inside it instead of gray text.

## Shots

| # | Chapter | Bars | Statement (on screen) | Picture | Year | In | Sound |
|---|---|---|---|---|---|---|---|
| 1 `stamp` | I · ЯРЛЫК | 2 | В 1954-М СЛОВО \*КИБЕРНЕТИКА\* БЫЛО ПРИГОВОРОМ. | a dictionary page; a stamp grows out of the screen and lands on beat 3 | 1954 | | impact |
| 2 `who` | | 2 | ЕЁ ВЕРНУЛ \*МАТЕМАТИК.\* | the name rising letter by letter; three dated facts | → 1911 | push up | |
| 3 `course` | II · СХЕМА | 2 | 1952. ПЕРВЫЙ В СТРАНЕ КУРС \*ПРОГРАММИРОВАНИЯ\* | a blackboard, a lecture counter 1 → 8 | → 1952 | dip | |
| 4 `numbers` | | 2 | МАШИНА ЗНАЛА ТОЛЬКО \*ЧИСЛА.\* | scrolling octal columns, one digit flickers | | cut | |
| 5 `scheme` | | 3 | ЛЯПУНОВ: СНАЧАЛА \*СХЕМА.\* / РАЗБЕЙ ЗАДАЧУ НА \*ОПЕРАТОРЫ\* | a flowchart draws itself; a token runs two loops, then exits | | push up | |
| 6 `compile` | | 3 | ПОТОМ ПРОГРАММА СОБЕРЁТ ИХ \*САМА.\* | the blocks feed a gear, "ПП"; code lines print by themselves | → 1953 | flash | printer ticks |
| 7 `seminar` | III · ИМЯ | 2 | 1954. В МГУ ОН СОБИРАЕТ \*СЕМИНАР.\* | six professions dock around "КИБЕРНЕТИКА" | → 1954 | dip | |
| 8 `article` | | 2 | 1955. ПЕРВАЯ СТАТЬЯ В ЕЁ \*ЗАЩИТУ.\* | the article lands on the old dictionary page | → 1955 | punch | whoosh |
| 9 `council` | | 2 | 1959. ПРИ АКАДЕМИИ НАУК — СОВЕТ ПО \*КИБЕРНЕТИКЕ\* | the old stamp struck out; `НАУКА` lands | → 1959 | cut | impact |
| 10 `siberia` | IV · ШКОЛА | 3 | С 1961-ГО — \*СИБИРЬ.\* / ОН ВЫРАСТИЛ \*ШКОЛУ.\* | Moscow → Novosibirsk, then a tree of five students | → 1961 | dip | |
| 11 `end` | | 2 | ЯРЛЫК ОТЛЕПИЛСЯ. \*НАУКА\* ОСТАЛАСЬ. | the dictionary page again; the red stamp dissolves, a scheme runs | → 1973 | push up | whoosh |

Transition vocabulary: `cut` (the next step of one thought), `push` up (the swipe of a feed: the next step), `dip` (a new chapter), `flash` (the reveal), `punch` (a turn).

## Facts and sources

Everything on screen, with where it comes from. Where sources disagree, the film says less.

| On screen | Fact | Source |
|---|---|---|
| 1911 — 1973 | Born 25 Sep (8 Oct) 1911 in Moscow; died 23 Jun 1973 in Moscow | [Wikipedia](https://ru.wikipedia.org/wiki/Ляпунов,_Алексей_Андреевич), [computer-museum.ru](https://www.computer-museum.ru/galglory/lypunov2.htm) |
| С 1932 · ученик Н. Н. Лузина | A student of Luzin from 1932 | Wikipedia; computer-museum.ru |
| 1940 · теорема о выпуклости | The convexity theorem (integrability and convexity), 1940 | Wikipedia |
| 1944 · артиллерист, орден Красной Звезды | Commander of a topographic platoon in the artillery; Order of the Red Star, 1944 | Wikipedia |
| 1954 · «ЛЖЕНАУКА» · Краткий философский словарь, 1954 | The 1954 edition of the Brief Philosophical Dictionary defined cybernetics as a reactionary pseudoscience (the wording is quoted differently in different sources, so the film shows only the stamped word and the dictionary's title, not a quote) | [computer-museum.ru, chapter 8](https://computer-museum.ru/articles/aleksey-andreevich-lyapunov-ocherk-zhizni-i-tvorchestva-okruzhenie-i-lichnost/270/) |
| 1952 · первый в стране курс программирования; МГУ; Соболев; 8 лекций | In 1952-53, invited by S. L. Sobolev, he gave the first programming course in the country at Moscow University: "Principles of programming", 8 lectures | computer-museum.ru; [letopis.msu.ru](https://letopis.msu.ru/peoples/8675) |
| операторный метод; операторы и логические условия | He described the solution of a problem as an operator scheme: arithmetic and control operators and logical conditions | computer-museum.ru |
| программирующая программа · прообраз компилятора | The scheme was to be turned into a machine program by a "programming program". "Forerunner of a compiler" is the film's gloss, not a quote | computer-museum.ru |
| 1954 · семинар «Автоматы и мышление» · 1954–1964 | A seminar at the Mech-Math faculty, 1954 to 1964; mathematicians, economists, engineers, biologists, linguists, philosophers took part (computer-museum.ru dates its first year 1954-55) | Wikipedia; computer-museum.ru |
| 1955 · Соболев · Китов · Ляпунов · «Вопросы философии» №4 | "Основные черты кибернетики", the first positive article about cybernetics in the USSR | [kitov.rea.ru](https://kitov.rea.ru/pervaa-pozitivnaa-stata-o-kibernetike); computer-museum.ru |
| 1959 · Совет по кибернетике при АН СССР · Берг · Ляпунов | The Council on Cybernetics under the Academy of Sciences; chairman A. I. Berg, deputy A. A. Lyapunov | computer-museum.ru |
| 1961 · Новосибирск · ≈ 2 800 км | Moved to the Siberian Branch of the Academy in 1961 (to Akademgorodok in 1962). Great-circle distance Moscow to Novosibirsk: 2,813 km from the coordinates (55.75 N 37.62 E, 55.03 N 82.92 E) | Wikipedia; computer-museum.ru |
| кафедра в НГУ · физматшкола | He founded the chair of theoretical cybernetics at Novosibirsk State University, and with M. A. Lavrentiev the physics and mathematics boarding school at Akademgorodok (first chairman of its council) | Wikipedia; computer-museum.ru |
| Ершов, Журавлёв, Лупанов, Кетков, Федотов | Listed as his students | Wikipedia |

Deliberately left out:

- A count of volumes of *Problems of Cybernetics* (founded 1958): one source says 29 volumes under his editorship, another at least 6-7.
- Attribution of the whole rehabilitation to one man. The 1955 article had three authors and the film names all three; the Brief Philosophical Dictionary and the 1953 article "Whom does cybernetics serve?" (under the pseudonym "Materialist", *Voprosy filosofii* №5) are context, not shots.
- A portrait. The photograph supplied with the brief carries a date stamp, 1902, nine years before he was born, so it cannot show him. A verified photograph (with its source and licence) is a drop-in for shot 2.

## Genre and known weaknesses

Genre: **one life** ([20-silent-social.md](../../20-silent-social.md)), framed as myth vs fact (the label, then the label corrected). Word count: 13 statements (60 words) and 11 captions (47 words), 107 words over 50 s, inside the 2.5 words/s budget; the longest statement is 7 words.

Version 1 passes the silent-contract checks (hook by 1.5 s, one idea per frame, a callback ending) but its pictures are the weak layer: five of eleven fail the label test (a list of facts, six professions in boxes, a gear with a label, five names on a line, a count without a yardstick). The shot-by-shot critique and the fixes are in [21-infographics.md](../../21-infographics.md), "A worked critique".

## Checks run

- Contact sheets at 1 and 2 fps (`render/contact-sheet.sh`, portrait mode) and full-size stills (`render/still.mjs`) at every shot's start, middle and end.
- Text fit: `runtime/film.js` warns when a line is wider than the room and shrinks the statement. The first draft had four such warnings (sizes 95-100 px against 103), which would have made the type size wander from shot to shot; every statement now has the same size, 94 px, and a scan of the whole film gives no warnings.
- `render/music-report.mjs`: lint 98.5/100, no errors or warnings; the loudest section (the `НАУКА` stamp) is 2.3 LU above the film's average. With `--loudnorm`: true peak −1.6 dBFS.
