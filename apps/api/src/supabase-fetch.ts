type FetchLike = typeof fetch;

type SupabaseFetchOptions = {
  fetchImpl?: FetchLike;
  delay?: (milliseconds: number) => Promise<void>;
};

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createSupabaseFetch({
  fetchImpl = fetch,
  delay = wait,
}: SupabaseFetchOptions = {}): FetchLike {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (response.ok) return response;

    const body = await response.clone().text();
    if (!/JWT issued at future/i.test(body)) return response;

    await delay(1_000);
    return fetchImpl(input, init);
  };
}
