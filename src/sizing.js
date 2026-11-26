// Pure sizing calculation. Inputs must be normalized from verified broker metadata.
// marginPerUnit and equity must be expressed in the same account currency.
export function calculateSize({equity, percentage=0.2, marginPerUnit, minSize, sizeStep, maxSize, available}) {
 for (const [key,value] of Object.entries({equity,percentage,marginPerUnit,minSize,sizeStep,maxSize,available})) {
  if(typeof value !== "number" || !Number.isFinite(value) || value<=0) throw new Error("Invalid "+key);
 }
 if(percentage>100 || minSize>maxSize) throw new Error("Invalid sizing limits");
 const budget=equity*percentage/100;
 if(budget>available) throw new Error("Insufficient available margin");
 const raw=Math.min(budget/marginPerUnit,maxSize);
 const size=Number((Math.floor(raw/sizeStep)*sizeStep).toPrecision(12));
 if(size<minSize || size>maxSize || size*marginPerUnit>budget) throw new Error("No valid size within margin budget");
 return {size,budget,estimatedMargin:size*marginPerUnit};
}
