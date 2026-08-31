# Carduri de training

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
