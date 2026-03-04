export default async function(ctx: any) {
  ctx.__beforeStop = ctx.signal.aborted
  ctx.stop()
  ctx.__afterStop = ctx.signal.aborted
}
