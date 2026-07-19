import type { BrokerAdapter } from './BrokerAdapter'
import type { ProfileRepository } from '../persistence/ProfileRepository'
import { DemoAdapter } from './DemoAdapter'
import { RabbitMqAdapter } from './RabbitMqAdapter'
import { AzureServiceBusAdapter } from './AzureServiceBusAdapter'
import { KafkaAdapter } from './KafkaAdapter'

export class BrokerRegistry {
  private readonly adapters = new Map<string, BrokerAdapter>()

  constructor(private readonly profiles: ProfileRepository) {}

  get(profileId: string): BrokerAdapter {
    const cached = this.adapters.get(profileId)
    if (cached) return cached
    const { profile, secret } = this.profiles.getWithSecret(profileId)
    let adapter: BrokerAdapter
    switch (profile.brokerType) {
      case 'demo':
        adapter = new DemoAdapter(profile.id)
        break
      case 'rabbitmq':
        adapter = new RabbitMqAdapter(profile.id, profile.configuration, secret)
        break
      case 'azure-service-bus':
        adapter = new AzureServiceBusAdapter(profile.id, profile.configuration, secret)
        break
      case 'kafka':
        adapter = new KafkaAdapter(profile.id, profile.configuration)
        break
    }
    this.adapters.set(profileId, adapter)
    return adapter
  }

  async invalidate(profileId: string): Promise<void> {
    const adapter = this.adapters.get(profileId)
    this.adapters.delete(profileId)
    if (adapter) await adapter.close()
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.adapters.values()].map((adapter) => adapter.close()))
    this.adapters.clear()
  }
}
