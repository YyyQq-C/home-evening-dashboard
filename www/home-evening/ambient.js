/** 按整点返回背景序号，同一小时内所有设备结果一致。 */
export function ambientIndex(now,count){
  const size=Number(count);
  if(!Number.isInteger(size)||size<1)return 0;
  const hour=Math.floor(Number(now)/3600000);
  if(!Number.isFinite(hour))return 0;
  return ((hour%size)+size)%size;
}
