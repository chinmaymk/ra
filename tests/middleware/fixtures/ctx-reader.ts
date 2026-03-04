export default async function(ctx: any) {
  ctx.__saw = `iter=${ctx.iteration},max=${ctx.maxIterations},sid=${ctx.sessionId}`
}
