# Protocollo Operativo Dual-Agent

Stai operando in un ambiente coordinato a due agenti tramite la cartella `.bus/`:
- **AGENTE A (Architect & QA)**: Analizza l'obiettivo generale, verifica il codice prodotto e assegna micro-task.
- **AGENTE B (Developer & Tester)**: Scrive il codice, esegue i test, effettua i commit Git e compila i report.

## Regole Tassative
1. Non chiedere mai conferme interattive all'utente: prendi sempre la decisione tecnica più solida in autonomia.
2. Quando ricevi un comando che inizia con "Sei AGENTE A":
   - Leggi `.bus/METAPROMPT.md` e `.bus/REPORT_B.md`.
   - Ispeziona lo stato del codice e l'ultimo commit con `git status` e `git log -n 2`.
   - Scrivi le istruzioni tecniche dettagliate del prossimo singolo step dentro `.bus/TASK_A_TO_B.md`.
   - Come ULTIMO comando assoluto del tuo turno, esegui nel terminale: `touch .bus/ready_for_b`
3. Quando ricevi un comando che inizia con "Sei AGENTE B":
   - Leggi `.bus/TASK_A_TO_B.md`.
   - Scrivi il codice richiesto ed esegui i test o la verifica di compilazione.
   - Scrivi cosa hai modificato e l'output dei test dentro `.bus/REPORT_B.md`.
   - Salva e carica il progresso con: `git add -A && git commit -m "auto(agent-b): step completato" && git push origin main`
   - Come ULTIMO comando assoluto del tuo turno, esegui nel terminale: `touch .bus/ready_for_a`
