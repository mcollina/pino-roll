(async () => {
  const { default: tstyche } = await import('tstyche/tag')
  tstyche`--quiet --tsconfig baseline`
})()
