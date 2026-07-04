export function PageHeader({
  titulo,
  descricao,
  children,
}: {
  titulo: string
  descricao?: string
  children?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-balance">{titulo}</h1>
        {descricao && (
          <p className="mt-1 text-sm text-muted-foreground text-pretty">{descricao}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}
