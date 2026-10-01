# Contributing

Use Node.js 22+, run `npm test`, and open a pull request with the problem, change and validation. Add meaningful tests for billing, outcome or persistence behavior. Avoid dependencies until a concrete need warrants them.

Do not commit API keys, real client documents, personal data or provider response fixtures containing prompts. Use synthetic fixtures. Rates must declare provenance and inclusion semantics; never silently turn missing prices into zero.

The MVP is local and single-process. Discuss public hosting, tenancy, provider billing changes and new storage backends in an issue before substantial implementation. Report security concerns privately using the repository owner's GitHub profile contact options instead of posting credentials or exploit details publicly.
