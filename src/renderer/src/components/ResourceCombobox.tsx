import { useMemo, useState } from 'react'
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions
} from '@headlessui/react'
import { Check, ChevronDown } from 'lucide-react'
import type { DiscoveredEntity } from '@shared/domain'

interface ResourceComboboxProps {
  id: string
  label: string
  entities: DiscoveredEntity[]
  value: string
  disabled?: boolean
  onChange(value: string): void
}

export function ResourceCombobox({
  id,
  label,
  entities,
  value,
  disabled = false,
  onChange
}: ResourceComboboxProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const selected = entities.find((entity) => entity.name === value) ?? null
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return entities
    return entities.filter((entity) => entity.name.toLocaleLowerCase().includes(normalizedQuery))
  }, [entities, query])

  return (
    <div className="field resource-field">
      <label id={`${id}-label`} htmlFor={id}>{label}</label>
      <Combobox
        value={selected}
        onChange={(entity) => onChange(entity?.name ?? '')}
        by="name"
        disabled={disabled}
        immediate
        virtual={{ options: filtered }}
        onClose={() => setQuery('')}
      >
        <div className="resource-combobox">
          <ComboboxInput
            id={id}
            aria-labelledby={`${id}-label`}
            className="resource-input"
            displayValue={(entity: DiscoveredEntity | null) => entity?.name ?? ''}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar recurso"
            autoComplete="off"
          />
          <ComboboxButton className="resource-trigger" aria-label={`Abrir ${label.toLocaleLowerCase()}`}>
            <ChevronDown size={16} aria-hidden="true" />
          </ComboboxButton>
        </div>
        <ComboboxOptions
          anchor={{ to: 'bottom start', gap: 5 }}
          portal
          className="resource-options"
        >
          {({ option }: { option: DiscoveredEntity }) => (
            <ComboboxOption
              value={option}
              className={({ focus }) => `resource-option${focus ? ' resource-option-focus' : ''}`}
            >
              {({ selected: isSelected }) => (
                <>
                  <span className="resource-option-check">{isSelected ? <Check size={15} /> : null}</span>
                  <span className="resource-option-name">{option.name}</span>
                  {option.messageCount !== null ? (
                    <span className="resource-option-count">{option.messageCount.toLocaleString('es-CR')}</span>
                  ) : null}
                </>
              )}
            </ComboboxOption>
          )}
        </ComboboxOptions>
      </Combobox>
      {query && filtered.length === 0 ? <span className="resource-empty" role="status">Sin coincidencias</span> : null}
    </div>
  )
}
