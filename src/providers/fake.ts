import type { ChatProvider, ProviderInput, ProviderResult } from './provider.js';
// A transport fixture, never a behavioural simulation of a language model.
export class FakeProvider implements ChatProvider {
  readonly kind = 'fake' as const;
  constructor(environment: 'development' | 'test' | 'production') {
    if (environment === 'production') throw new Error('Fake provider is restricted to development/testing');
  }
  isAvailable() { return true; }
  async generate({ request }: ProviderInput): Promise<ProviderResult> {
    return { answer: request.locale === 'fi' ? '[KEHITYSTILA: ei tekoälyä] PersonaCoren testivastaus.' : '[DEVELOPMENT: not AI] PersonaCore test response.', sourceIds: [] };
  }
}
