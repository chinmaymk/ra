export default async function(ctx: any) {
  ctx.messages.push({ role: 'user', content: 'injected by middleware' })
}
