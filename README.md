# Training Activities

Aplicație web fără build (HTML + JS simplu), conectată la Supabase.

## Structură
- `index.html` + `learner.js` — pagina cursanților (link/QR primit de la trainer)
- `admin.html` + `admin.js` — panoul trainerului (login, jocuri/seturi, management carduri, sesiuni și grupe, control live, cronometru)
- `manual.html` — manualul de utilizare, cu cuprins, accesibil din admin
- `config.js` — cheile Supabase (URL + anon key)
- `style.css` — identitate vizuală comună

## Cum pui aplicația pe GitHub Pages

1. Creează un repository nou pe GitHub (public sau privat, ambele merg cu GitHub Pages dacă ai cont Pro; pentru cont gratuit trebuie public)
2. Încarcă toate fișierele din acest folder în repository (root, nu într-un subfolder)
3. Mergi la **Settings → Pages** din repository
4. La **Source**, alege **Deploy from a branch** → branch `main`, folder `/ (root)` → **Save**
5. După 1-2 minute, aplicația va fi live la:
   `https://<username-ul-tau>.github.io/<numele-repo-ului>/`

## Cum se folosește, pe scurt

1. **Tu (trainer):** intri pe `.../admin.html`, te loghezi cu email + parola contului creat în Supabase Authentication
2. Din selectorul de sus, creezi un **joc** și un **set de cărți** (butoanele „+ Nou”)
3. Adaugi carduri (individual sau în bulk) — rămân salvate pentru toate sesiunile viitoare din acel set
4. În tab-ul „Sesiuni & Control live”, alegi numărul de grupe și modul de distribuire a cărților → **„Creează sesiune și generează grupe”**
5. Distribui link-ul/codul QR fiecărei grupe (Teams, Zoom, sau afișat pe ecranul partajat)
6. Cursanții intră pe linkul lor (fără cont) și așteaptă până pornești cronometrul (sau alegi „fără cronometru”)
7. Din panoul de control, selectezi tab-ul grupei, dai click pe un card ca să-l evidențiezi live, apeși „Permite răsturnarea” ca să-i lași să-l întoarcă
8. La final, apeși **„Încheie sesiunea”**

Instrucțiuni complete, pas cu pas, sunt disponibile în `manual.html` (buton „📖 Manual” din header-ul paginii de admin).

## Notă despre securitate

Cheia `anon` din `config.js` este publică prin design — accesul e controlat de politicile RLS din Supabase (scrierea e permisă doar userilor autentificați, adică ție ca trainer).


### Nodul comunicării — 3 activități online (v36–v39)
- **Desenează după instrucțiuni** — canvas individual 4:3 (responsive, funcționează la rotirea telefonului) cu creion, **forme (dreptunghi, triunghi, cerc) care rămân selectate până le fixezi: se rotesc liber la orice unghi, se mută, se recolorează sau se șterg**, paletă de culori (plus culoare la alegere), radieră și „Șterge tot”, plus instrucțiuni pe ecran. **Scenariile le creează fiecare trainer** („Scenariile mele”, private): nume și **una sau mai multe runde (până la 10)**, fiecare cu instrucțiuni ca **listă numerotată** (o instrucțiune pe rând; prefixele „1.”, „-” se curăță automat), opțional o **imagine de referință** (PNG, JPG sau BMP; se aduce la 4:3, max. 1600×1200, JPEG) și bifa „participanții pot pune întrebări”. Trainerul vede instrucțiunile numerotate („de rostit”), butonul „Arată modelul” (ascuns în timpul rundei, vizibil la Reveal) și comutatorul „Suprapune modelul” (liniile imaginii, în roșu, peste desenele participanților). La Reveal, fiecare participant poate comuta între „Desenul meu”, „Modelul” și „Suprapus”. **După fiecare Reveal urmează pasul „Desenele tuturor”**: fiecare participant vede modelul (dacă runda are imagine de referință), apoi **desenul propriu primul**, apoi desenele celorlalți, **anonim** (fără aliasuri), cu opțiunea „Suprapune modelul” peste toate; desenul de pe canvas se trimite automat la trecerea la pasul următor, dacă are ceva desenat. Etape: Lobby → pentru fiecare rundă N: Runda N → Reveal N → Desenele tuturor · runda N → Debrief (un scenariu cu o singură rundă are doar Runda 1, un scenariu cu 5 runde le parcurge pe toate cinci). Scenariul ales se copiază în sesiune. Pentru mai mult de 2 runde (și pentru pașii „Desenele/Răspunsurile tuturor”) rulează o dată `supabase/add-communication-more-rounds.sql` (înlocuiește `add-communication-results-stages.sql`; extinde constrângerile de pe `communication_sessions.status` **și** de pe `communication_submissions.round`). Dacă baza nu e actualizată, trainerul vede un avertisment în lobby (înainte de start) și pornirea e blocată; participantul primește un mesaj clar.
- **Reconstruiește modelul** — piese geometrice pe o grilă 4×4, în **exact 3 runde**, fiecare cu **alt model** și alt stil de descriere citită de facilitator: **(1) interpretabilă** (indicii vagi: „lângă cerc”, „undeva sub triunghi”; aceeași descriere se potrivește mai multor așezări), **(2) stufoasă** (informația corectă este acolo, dar îngropată în cuvinte: digresiuni, repetiții, precizări fără folos), **(3) exactă, cu sistem de referință** (rândurile se numără de sus în jos, coloanele de la stânga la dreapta, fiecare piesă cu rând și coloană; pe ecranul participanților rândurile și coloanele sunt **numerotate**, deci nimeni nu are cum să greșească). Fiecare rundă are ciclul: **poziționare** (ce au participanții pe grilă se trimite automat la trecerea la pasul următor) → **reveal individual** (modelul și ce a realizat fiecare, piese corecte în verde, greșite în roșu, scor) → **rezultatele tuturor** (modelul, rezultatul propriu primul, apoi ale celorlalți, anonim); la final, debrief. Trainerul vede pentru fiecare rundă stilul, o indicație și descrierea gata scrisă, de citit. Modelele și textele se generează (practic nelimitat; „🎲 Altă variantă” în lobby, salvat în `communication_sessions.prompt_index`). **În lobby**, trainerul poate **previzualiza cele 3 modele pe grila 4×4** (ascuns implicit, ca să nu apară pe ecranul proiectat; fiecare cu descrierea de citit, pliabilă). **Debrief propriu** (6 întrebări pe cele 3 runde: ce am presupus, de unde vin diferențele, ce a încurcat în descrierea stufoasă, comparația rundelor 1–2, ce a schimbat sistemul de referință, transferul la serviciu), cu **rezumatul scorurilor pe runde** (al participantului și media grupului, anonim). Cere migrarea `supabase/add-communication-more-rounds.sql` (statusuri `round3…` și răspunsuri pentru runda 3).
- **Ce ai înțeles?** — mesaje ambigue de la client, presupunere (runda 1) / întrebare de clarificare (runda 2) și răspuns. Fluxul: Lobby → Runda 1 → Reveal 1 (informația care lipsea + răspunsul propriu) → **Răspunsurile tuturor · runda 1** (fiecare participant vede răspunsurile tuturor colegilor, anonim, cu al lui primul, fără informația lipsă) → Runda 2 → Reveal 2 → **Răspunsurile tuturor · runda 2** → Debrief. Ce a scris participantul și nu a trimis se salvează automat la trecerea la pasul următor. Cere o migrare unică în Supabase (`supabase/add-communication-results-stages.sql`).
- **Scenarii:** la „Desenează după instrucțiuni” și la „Ce ai înțeles?” fiecare trainer își creează și își editează scenariile în panoul **„Scenariile mele”** (două file; private; tabelul `communication_scenarios`; scenariul ales se copiază în `communication_sessions.scenario`). La „Ce ai înțeles?” un scenariu are 1 sau 2 runde, fiecare cu **mesajul clientului** și **informația lipsă** (o vede doar trainerul); cele 4 scenarii din cod (`github/communication-data.js`) rămân **scenarii de bază**, comune, doar pentru citire, cu butonul „Copiază în scenariile mele”. În lobby, la „Ce ai înțeles?”, un selector cu două grupuri („Scenariile mele” / „Scenarii de bază”); implicit se folosește ultimul scenariu ales. La „Reconstruiește modelul” modelele se generează (în lobby: „🎲 Altă variantă”, salvat în `communication_sessions.prompt_index`).
- Trainerul intră din `communication-admin.html` sau din butonul **Nodul comunicării** din admin. Link participanți + cod QR (cu descărcare PNG/JPG).
- Participanții intră fără cont, prin linkul generat, în `communication.html`. Alias deja folosit în sesiune: participantul este întrebat dacă vrea sufixul „(2)”, „(3)” etc. sau alege altul.
- „Încheie” cere confirmare; după încheiere rămân vizibile rezultatele tuturor rundelor.
- Instalare nouă: schema (inclusiv drepturile și indexul pentru alias) este inclusă în `supabase/install-complete.sql`.
- Upgrade pe un proiect existent: rulează `supabase/add-communication-modes.sql` (idempotent). Dacă în proiect existau deja tabele `communication_*` dintr-o versiune veche (coloane `trainer_id`, `participant_token_hash`) sau apar erori 401 la deschiderea linkului participantului, rulează `supabase/fix-communication-prod.sql`.
- Pentru scenariile proprii (desen) rulează o dată `supabase/add-communication-scenarios.sql` (idempotent; este inclus și în `install-complete.sql` pentru instalări noi). Imaginile se încarcă în bucket-ul existent `card-images`, folderul `communication/`.
- **Navigare între etape (toate modurile):** deasupra butoanelor „← Etapa anterioară” și „Etapa următoare →” apare un hint cu numele etapei la care se ajunge cu click pe butonul de dedesubt (de ex. „Urmează: Reveal runda 2”; la ultimul pas: „Urmează: Încheiată (sesiunea se închide)”).
- **Desene ușoare (capacitate):** desenul se salvează ca **JPEG 640×480 + o miniatură 360×270** (câțiva KB, față de zeci de KB cu PNG). Trainerul **nu mai descarcă toate desenele la fiecare reîmprospătare**: cere doar lista și o miniatură pentru desenele noi sau schimbate (ținute în memorie); „Desenele tuturor” folosește doar miniaturi, iar atingerea unui desen îl deschide **mărit** (descărcat atunci). Desenele mai vechi (PNG) rămân vizibile. Nu cere SQL nou. Estimare (neverificată pe Supabase real): sesiuni de 100+ de participanți la desen în limita planului Free, de ordinul a ~0,5 GB transfer pentru o sesiune de 3 runde.

### Recapitulare (modul independent, v58)
- **Ce face:** după orice activitate, participanții intră pe un link (sau cod QR), sunt împărțiți **aleatoriu în două echipe** (Roșii / Albaștri) și își scriu **întrebări pentru echipa adversă**. La „Aruncă întrebarea” un **bulgăre de hârtie mototolită** zboară animat din tabăra echipei spre cea adversă; întrebările sunt listate pe **echipa care trebuie să răspundă**. Pe laptop: întrebarea în stânga, câmpul de luptă în dreapta; pe telefon: câmpul de luptă sus, întrebarea jos.
- **Trainerul** (`recap-admin.html`, din butonul „🎯 Recapitulare” al paginii Nodul comunicării): temă, link + QR, împărțire în echipe, reîmpărțire, moderare (ascunde/arată o întrebare; cele ascunse coboară la finalul listei, cu fundal și font roșii, cea mai recent ascunsă prima, iar mutarea e animată; aliasul autorului e vizibil doar trainerului), „Mod proiector”, „Copiază întrebările”, încheiere. Cine intră târziu e pus automat în echipa mai mică.
- **Limită pe participant (v59):** trainerul stabilește, la creare sau în timpul sesiunii, câte întrebări poate arunca fiecare participant (câmp numeric cu săgeți; **0 = fără limită**; nu coboară sub 0; maximum 100). Participantul vede „Întrebări rămase: n din N”; la limită nu mai poate scrie. Regula e impusă și în baza de date.
- **Închidere de tot (v59):** „Încheie” oprește aruncarea (tabloul rămâne vizibil); „Închide de tot” (după Încheie) șterge sesiunea, participanții și întrebările, iar linkul nu mai funcționează; în Lobby: „Anulează sesiunea”. „Sesiune nouă” nu șterge nimic.
- **Instrucțiuni** pentru trainer, în pagina `recap-admin.html` (pe ecranul de creare și în panoul sesiunii).
- **Reguli:** maximum 200 de caractere pe întrebare; pauză de 8 secunde între întrebările aceluiași participant (baza de date impune minimum 5); participanții văd doar echipa autorului. Respectă setarea „reduce mișcarea”.
- **Ușor la încărcare:** fără conexiuni permanente; fiecare participant cere doar ce s-a schimbat (~0,4 KB pe reîmprospătare, măsurat în teste), iar bulgării în exces nu se animează toți deodată.
- **Fișiere:** `recap.html`, `recap.js`, `recap.css` (participant), `recap-admin.html`, `recap-admin.js` (trainer), `recap-shared.js` (câmpul de luptă, listele, sincronizarea). Independent de celelalte jocuri: are propriile tabele.
- **Supabase:** rulează `supabase/add-recap.sql` (idempotent; inclus și în `install-complete.sql`; la actualizarea de la v58 se rulează din nou, pentru limita de întrebări). Tabelele `recap_sessions`, `recap_participants`, `recap_questions`; regulile (echipa autorului, sesiune activă, ritm, lungime) sunt impuse în baza de date.

### v61: temă de culori (toată aplicația)
- **Butonul „🎨 Temă”** în antetul celor trei panouri de trainer: 6 teme gata făcute (Pergament = aspectul de până acum, Noapte, Grafit, Albastru corporate, Bordo, Contrast înalt) sau **Personalizată**, cu 4 culori (fundal, suprafață, principală, accent). **Textul se alege automat**: deschis pe fundal închis, închis pe fundal deschis, cu contrast garantat ≥ 4,5:1 (și pe butoane, antet, margini, mesaje).
- Se salvează **pe trainer** (`trainer_settings`) și se aplică pe paginile lui **și pe ecranele participanților la sesiunile lui**: jocurile cu cărți, Nodul comunicării și Recapitulare. Participanții primesc doar tema, printr-o funcție (`session_theme`), nu emailul trainerului. Rămân fixe: canvasul de desen, culorile echipelor, culorile de stare.
- Fișiere: `theme.js` (motor + fereastră de alegere), `supabase/add-themes.sql` (idempotent; inclus în `install-complete.sql`).

### v62: Recapitulare — „↩ Aruncă înapoi”
- Pe întrebările adresate echipei lui, fiecare participant are „↩ Aruncă înapoi”: aceeași întrebare pleacă înapoi spre echipa care a pus-o. **O singură returnare pe întrebare** (primul coleg care apasă; dublurile sunt refuzate și în baza de date, prin index unic pe `parent_id`), dar lanțul poate continua, deci **ping-pong fără limită**. Returnările nu consumă din limita personală și nu au pauză.
- Supabase: rulează din nou `supabase/add-recap.sql` (idempotent).

### v63: desen — grilă de pătrățele
- Butonul „▦ Grilă” (12 coloane A–L × 9 rânduri 1–9) afișează un reper peste canvas, la reveal și în galerie; **o pornește și o oprește participantul** (alegerea rămâne pe dispozitiv), iar grila nu intră în desenul salvat. Trainerul are bifa lui în „Rezultate”. Fără modificări în Supabase.

### v64: Recapitulare — schimb de întrebări între echipe, fără etichete
- Fără etichetele „aruncată înapoi” / „returnată de”. Fiecare întrebare apare **o singură dată, doar la echipa care trebuie să răspundă** (coloana „Întrebări pentru echipa …”). „↩ Aruncă înapoi” o mută în lista celeilalte echipe, **fără limită, până încheie trainerul sesiunea**; dublele apăsări simultane sunt oprite. „Ascunde” acționează pe ultima aruncare. Fără modificări în Supabase.

### v65: mesaj de încheiere la Recapitulare, numerotarea grilei în afara desenului
- **Recapitulare:** după „Încheie”, participanții văd sus mesajul „Recapitularea s-a încheiat. Trainerul a oprit aruncarea de întrebări. Mulțumim pentru participare!” (înainte pagina doar ascundea câmpul de scris).
- **Desen — grilă:** numerotarea (literele A–L deasupra, cifrele 1–9 în stânga) stă **în afara zonei de desen**, într-un cadru cu margini, **și la participant, și la trainer**: pe canvas, la reveal, în galerie, la „Rezultate” și la modelul de referință. Liniile rămân peste desen, iar pe laptop desenul nu își schimbă mărimea când se pornește grila. Fără modificări în Supabase.

### v66: desen — grila numerotată a trainerului, pornită implicit
- Trainerul vede **grila cu numerotare (A–L, 1–9) pornită implicit**, peste **modelul din „Instrucțiuni trainer”** și peste desenele din „Rezultate”, ca să poată da și verifica indicații cu coordonate. Bifa „Pătrățele” este acum și **lângă model**, nu doar în „Rezultate” (cele două se sincronizează), cu o notă despre folosirea coordonatelor. La participant grila rămâne oprită implicit, pornită din butonul „▦ Grilă”. Fără modificări în Supabase.

### v67: Recapitulare — cronometru (Start cu timp / fără timp, Pauză, Adaugă timp)
- În Lobby: **„Start cu timp”** (minute și secunde; implicit 5:00) sau **„Start fără timp”**. Participanții văd **timpul rămas** sus; trainerul are **Pauză / Reia**, **Adaugă timp** (minute și secunde) și poate activa un cronometru și într-o sesiune pornită fără timp. **La pauză sau după expirare nu se mai poate arunca nimic** (nici „Aruncă înapoi”); regula e impusă și în baza de date. Timpul se calculează cu **ora serverului** (același pe toate ecranele, chiar cu ceas decalat). În „Mod proiector”, timpul apare mare.
- Supabase: rulează din nou `supabase/add-recap.sql` (idempotent; coloane noi pe `recap_sessions`, funcțiile `recap_timer` și `recap_server_time`, regulă nouă la aruncarea întrebărilor).

### v68: ecranul de autentificare, mereu pe tema implicită
- Ecranele de autentificare (jocuri cu cărți, Nodul comunicării, Recapitulare) folosesc **mereu tema implicită (Pergament), la toți**. Tema trainerului se aplică abia după autentificare; la deconectare nu rămâne în browser pentru următoarea persoană; un cont fără temă salvată nu o moștenește pe a altuia. Fără modificări în Supabase.

### v69: grila, implicit oprită la toți participanții
- Grila de pătrățele pornește **oprită la toți participanții, pe laptop și pe telefon**. Alegerea (pornit/oprit) se păstrează **doar în sesiunea curentă** (la reîncărcare și între runde); o **sesiune nouă începe mereu cu grila oprită**, chiar dacă pe acel dispozitiv fusese pornită înainte. La trainer rămâne pornită implicit. Fără modificări în Supabase.

### v70: întrebări de debrief personalizate pe fiecare scenariu
- În „Scenariile mele” (Desenează după instrucțiuni și Ce ai înțeles?), formularul are secțiunea **„Întrebări de debrief (opțional)”**: câte o întrebare pe rând (cel mult 10, fiecare de cel mult 300 de caractere), cu previzualizare și butonul „Încarcă întrebările standard”. La etapa „Debrief”, participanții și trainerul văd **întrebările scenariului**, altfel cele standard. Lista de scenarii marchează „debrief propriu”. Supabase: rulează `supabase/add-scenario-debrief.sql` (idempotent; inclus în `install-complete.sql`).

### v73: Recapitulare — „Permite aruncarea” (înlocuiește v71 și v72)
- Bifa **„Permite aruncarea”** (la trainer, **debifată implicit**, activabilă și dezactivabilă oricând) controlează butonul **„Aruncă înapoi”**. **Debifată: niciun buton** în dreptul întrebărilor; participanții scriu și trimit întrebări către echipa adversă (în limita stabilită; 0 = nelimitat). **Bifată: butonul apare** la fiecare întrebare primită. **Debifată din nou**: butoanele dispar, iar întrebările rămân fixe, în echipele în care erau. Întrebările noi se pot scrie oricând, în limita permisă. Impus și în baza de date. Supabase: rulează din nou `supabase/add-recap.sql` (idempotent), dacă nu l-ai rulat deja pentru v72.

### v74: Recapitulare pe telefon — panou de scris minimizabil, cu restrângere automată
- Pe telefon, panoul de scris are o **bară „✏️ Scrie o întrebare”** care îl strânge la o singură bară și îl deschide la loc; **se strânge singur după fiecare trimitere** și când nu se mai poate scrie (limită, pauză, timp expirat). Câmpul e mai mic și crește singur. Pe laptop nu se schimbă nimic. Fără SQL.

### v75: pagina trainerului la Recapitulare — bară live, setări strânse, „Încheie” singur, pastilă în modul proiector
- **Bară live** deasupra câmpului de luptă, lipită sus la derulare: **comutatorul „Aruncare”** (mare, cu starea scrisă și confirmare scurtă) și **cronometrul** (Pauză/Reia, +1 min, Adaugă timp). **„Setări sesiune”** (link, QR, limită) se strâng singure la start. **„Încheie”** e singur, sus în dreapta. În **Mod proiector**, bara devine o pastilă cu comutatorul. Fără SQL.

### v76: Recapitulare, intrare de sine stătătoare
- Butonul **„🎯 Recapitulare”** a fost **scos din Nodul comunicării** și mutat în **pagina principală a trainerului** (de la v77, în meniul trainerului), lângă „Jocuri de comunicare”. Pagina Recapitulării nu mai trimite la Nodul comunicării, ci înapoi la meniul principal. Antetul meniului principal trece pe rânduri pe ecrane înguste (înainte, pe telefon, „Temă” și „Deconectare” ieșeau din ecran). Fără SQL.

### v77: pagina inițială cu „Intru cu cod” și meniul trainerului
- **Pagina inițială** (`index.html`), pentru oricine: participantul scrie **codul sesiunii** și ajunge la activitatea potrivită (cărți pe grupă, Colourblind, Nodul comunicării, Recapitulare). Pagina cursantului de la cărți se mută la `grupa.html`; linkurile vechi `index.html?g=…` sunt redirecționate. **Meniul trainerului** (`trainer.html`): autentificare, plăci pentru activități (din registrul `activities.js`) și „Sesiuni în desfășurare” cu „Reia”. Codul sesiunii e afișat trainerului în fiecare activitate. Supabase: rulează `supabase/add-resolve-code.sql` (idempotent).

### Redenumire (v77)
- Aplicația se numește acum **Training Activities** (înainte „Carduri de training”), în pagini, manual și documentație. Adresele, linkurile și codurile QR nu se schimbă.
