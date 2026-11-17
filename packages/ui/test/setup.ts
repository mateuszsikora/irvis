import { configure } from '@testing-library/react';

// The former self-hosted CI runner was about four times slower than a development
// machine; Testing Library's default of 1 second for findBy queries and
// waitFor is too short there. Why: docs/features/ui-technical.md#tests
configure({ asyncUtilTimeout: 5000 });
