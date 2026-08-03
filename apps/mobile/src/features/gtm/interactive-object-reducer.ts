import type { InteractiveObject } from "@gtm/contracts";

export type InteractiveObjectEvent =
  | { kind: "upsert"; object: InteractiveObject }
  | { kind: "delete"; objectId: string };

export function reduceInteractiveObjects(
  state: InteractiveObject[],
  event: InteractiveObjectEvent,
): InteractiveObject[] {
  const index = state.findIndex((object) => object.id === (event.kind === "upsert" ? event.object.id : event.objectId));
  if (event.kind === "delete") {
    if (index < 0) return state;
    return state.filter((_, currentIndex) => currentIndex !== index);
  }
  if (index < 0) return [...state, event.object];
  if (state[index]!.version >= event.object.version) return state;
  return state.map((object, currentIndex) => currentIndex === index ? event.object : object);
}
