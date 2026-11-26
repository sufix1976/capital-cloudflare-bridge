// Candidate EPICs: verify against Capital.com DEMO before enabling orders.
export const aliases = Object.freeze({
 GER40:"DE40", DE40:"DE40", NAS100:"US100", US100:"US100", USTEC:"US100",
 SPX500:"US500", US500:"US500", US30:"US30", DJ30:"US30",
 UK100:"UK100", FTSE100:"UK100", EU50:"EU50", ESTX50:"EU50", STOXX50:"EU50",
 J225:"J225", JP225:"J225", XAUUSD:"GOLD", GOLD:"GOLD",
 XAGUSD:"SILVER", SILVER:"SILVER", USOIL:"OIL_CRUDE", WTI:"OIL_CRUDE",
 OIL_CRUDE:"OIL_CRUDE", BTCUSD:"BTCUSD", ETHUSD:"ETHUSD", EURUSD:"EURUSD"
});
export function resolveInstrument(symbol) {
 if(typeof symbol !== "string") return null;
 const key=symbol.trim().toUpperCase().split(":").pop();
 return Object.hasOwn(aliases,key) ? aliases[key] : null;
}
