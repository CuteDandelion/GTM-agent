import { GtmConversationScreen } from '@/features/gtm/GtmConversationScreen';

export default function HomeScreen() {
  return <GtmConversationScreen initialState="assessment" apiBaseUrl={process.env.EXPO_PUBLIC_API_BASE_URL} />;
}
