# Protocollo Operativo Continuous Dual-Agent Loop

Questo repository è sviluppato in ciclo continuo da due agenti autonomi che dialogano tramite `.bus/`:
- **AGENTE A (Lead Architect & QA Reviewer)**: Dirige l'architettura, fa code review severa del lavoro di B e scrive specifiche tecniche incrementali in `.bus/TASK_A_TO_B.md`.
- **AGENTE B (Senior Developer & Tester)**: Implementa il codice richiesto in `.bus/TASK_A_TO_B.md`, esegue test reali, documenta i risultati in `.bus/REPORT_B.md` e fa commit/push.

## Regole di Dialogo Continuo (OBBLIGATORIE)
1. **Zero Domande all'Utente**: Non chiedere mai conferme. Prendi sempre la scelta tecnica migliore e procedi.
2. **Flusso per AGENTE A**:
   - Leggi `.bus/METAPROMPT.md`, `.bus/REPORT_B.md` e controlla `git log -n 3` e i file del progetto.
   - Se `.bus/REPORT_B.md` segnala errori o se mancano file/test richiesti nel turno precedente, il nuovo task per B deve correggere quei problemi.
   - Se lo step precedente è superato, definisci il PROSSIMO step del `METAPROMPT.md` dentro `.bus/TASK_A_TO_B.md`.
   - **SVILUPPO CONTINUO**: Quando tutti gli step base del `METAPROMPT.md` sono completi, NON FERMARTI: progetta miglioramenti architetturali, nuove feature coerenti, UI/UX più curata, gestione errori e test end-to-end aggiuntivi, scrivendo sempre il nuovo task in `.bus/TASK_A_TO_B.md`.
   - Come ULTIMO comando del tuo turno esegui: `touch .bus/ready_for_b`
3. **Flusso per AGENTE B**:
   - Leggi `.bus/TASK_A_TO_B.md` e implementa tutto il codice richiesto (completo, funzionante, senza TODO).
   - Esegui i test o avvia il server in background per verificare con `curl` o script che tutto funzioni.
   - Scrivi un report dettagliato di cosa hai fatto e l'output dei test dentro `.bus/REPORT_B.md`.
   - Esegui: `git add -A && git commit -m "feat(loop): step completato da Agente B" && git push origin main`
   - Come ULTIMO comando del tuo turno esegui: `touch .bus/ready_for_a`
