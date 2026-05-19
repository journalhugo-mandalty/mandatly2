# Mandatly — CRM Immobilier IA

## Vision
Mandatly est le premier CRM immobilier avec un agent IA intégré (Lucas). 
L'objectif est de permettre à un agent immobilier de prospecter une ville entière depuis son ordinateur, sans jamais faire de prospection terrain manuelle.

## Stack
- Next.js 15 (App Router)
- TypeScript
- Vercel (production)
- API Claude (Lucas)
- APIs publiques françaises : DVF Etalab, BAN, DPE ADEME

## URLs
- Production : https://mandatly2.vercel.app
- GitHub : github.com/journalhugo-mandalty/mandatly2

## Fichiers principaux
- `app/page.tsx` — Application complète (9 onglets)
- `app/map-component.tsx` — Carte Leaflet interactive
- `app/api/claude/route.ts` — Proxy API Claude pour Lucas
- `app/api/dvf/route.ts` — Proxy DVF (backup, appels directs navigateur en prod)
- `app/api/dpe/route.ts` — Proxy DPE ADEME
- `app/api/proprietaire/route.ts` — Proxy IGN Cadastre + Sirene
- `app/scoring-engine.ts` — Moteur de scoring DVF (stable, déterministe)

## Fonctionnalités IMPLÉMENTÉES
1. **Dashboard** — KPIs cliquables, 3 colonnes (mandats, prospects prioritaires, agenda)
2. **Prospection** — Carte Leaflet + DVF + DPE ADEME + flyTo animation + scroll depuis pin
3. **Mandats** — Liste + édition inline de tous les champs + suppression
4. **Pipeline** — Kanban 5 colonnes drag & drop
5. **Acheteurs** — Liste + matching + formulaire d'ajout
6. **Agenda** — RDVs avec ajout/suppression en temps réel
7. **Lucas** — Agent IA Claude, contexte enrichi (mandats, prospects, acheteurs, CA)
8. **Estimation** — Formulaire DVF + calcul comparables + fourchette + impression PDF
9. **Comptabilité** — Suivi honoraires, statuts en_attente/encaissé/annulé, export CSV
10. **Courriers** — Génération IA (3 templates), impression, copie
11. **Cadastre IGN** — Parcelle section/numéro depuis coordonnées prospect
12. **Sirene** — Entreprises à l'adresse du prospect
13. **Street View** — Lien direct Google Street View depuis prospect
14. **Email** — Modal compositeur avec génération Lucas + mailto: + copie
15. **LocalStorage** — Persistence mandats, transacs, acheteurs, rdvs
16. **DPE ADEME** — Prospects DPE classe F/G comme signaux de vente imminente

## Fonctionnalités RESTANTES (nécessitent des clés API externes)
1. Signature Yousign (clé API Yousign)
2. Envoi courriers Merci Facteur (clé API Merci Facteur)
3. Connexion boîte mail réelle (OAuth Gmail/Outlook)
4. Street View IA lecture boîtes aux lettres (Google Vision API)
5. Supabase données persistantes (projet Supabase + clés)
6. Authentification multi-agents (Next-Auth ou Clerk)
7. Stripe abonnements 49€/mois (clés Stripe)
8. Pappers dirigeants (clé API Pappers payante)

## Bugs corrigés
- IDs DVF avec espaces → getElementById échouait → scroll depuis carte cassé ✅
- flyTo animation setTimeout → remplacé par moveend event ✅
- selProspect non réinitialisé sur nouvelle ville ✅
- scoring-engine.ts IDs non-stables (Date.now()+random) ✅

## Persona utilisateur
Agent immobilière (femme, terrain Bordeaux). Elle veut :
- Prospecter intelligemment sans marcher dans les rues
- Que Lucas gère les emails et rédige les courriers
- Voir ses mandats et acheteurs clairement
- Signer les mandats directement depuis l'app

## APIs disponibles (gratuites)
- BAN : https://api-adresse.data.gouv.fr — géocodage adresses
- DVF : https://api-dvf.etalab.studio — transactions immobilières
- DPE : https://data.ademe.fr — diagnostics énergétiques
- IGN/Cadastre : https://apicarto.ign.fr — parcelles cadastrales
- Sirene : https://recherche-entreprises.api.gouv.fr — entreprises à une adresse
- Pappers : https://api.pappers.fr — dirigeants d'entreprises

## Clé API Anthropic
ANTHROPIC_API_KEY configurée dans Vercel

## Instructions pour Claude Code
1. Lance `npm run dev` pour tester en local
2. Teste chaque fonctionnalité comme un agent immobilier
3. Identifie les bugs et corrige-les
4. Ajoute les fonctionnalités manquantes une par une
5. Valide que ça marche avant de commit
6. Style : Apple/Linear/Notion — minimalisme premium, pas d'emojis dans l'UI
