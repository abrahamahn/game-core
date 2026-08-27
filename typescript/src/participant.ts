const MAX_PARTICIPANT_ID_LENGTH = 160;

export type ParticipantErrorCode =
  | "GAME_INVALID_PARTICIPANT_ID"
  | "GAME_PARTICIPANT_ALREADY_EXISTS"
  | "GAME_PARTICIPANT_NOT_FOUND"
  | "GAME_PARTICIPANT_ALREADY_LEFT";

export class ParticipantError extends Error {
  public override readonly name = "ParticipantError";

  public constructor(public readonly code: ParticipantErrorCode) {
    super(code);
  }
}

export class ParticipantId {
  private constructor(private readonly value: string) {
    Object.freeze(this);
  }

  public static parse(value: string): ParticipantId {
    if (
      !hasValidParticipantIdLength(value) ||
      value.trim() !== value ||
      /[\p{Cc}\p{Cs}]/u.test(value)
    ) {
      throw new ParticipantError("GAME_INVALID_PARTICIPANT_ID");
    }
    return new ParticipantId(value);
  }

  public toString(): string {
    return this.value;
  }
}

export type ParticipantStatus = "active" | "left";

export class Participant {
  public constructor(
    public readonly id: ParticipantId,
    public readonly status: ParticipantStatus = "active",
  ) {
    Object.freeze(this);
  }

  public get isActive(): boolean {
    return this.status === "active";
  }
}

export class ParticipantRoster {
  readonly #participants: Map<string, Participant>;

  public constructor(participants: Iterable<Participant> = []) {
    this.#participants = new Map();
    for (const participant of participants) {
      const key = participant.id.toString();
      if (this.#participants.has(key)) {
        throw new ParticipantError("GAME_PARTICIPANT_ALREADY_EXISTS");
      }
      this.#participants.set(key, participant);
    }
  }

  public join(id: ParticipantId): void {
    const key = id.toString();
    if (this.#participants.has(key)) {
      throw new ParticipantError("GAME_PARTICIPANT_ALREADY_EXISTS");
    }
    this.#participants.set(key, new Participant(id));
  }

  public leave(id: ParticipantId): void {
    const key = id.toString();
    const participant = this.#participants.get(key);
    if (participant === undefined) {
      throw new ParticipantError("GAME_PARTICIPANT_NOT_FOUND");
    }
    if (!participant.isActive) {
      throw new ParticipantError("GAME_PARTICIPANT_ALREADY_LEFT");
    }
    this.#participants.set(key, new Participant(id, "left"));
  }

  public get(id: ParticipantId): Participant | undefined {
    return this.#participants.get(id.toString());
  }

  public isActive(id: ParticipantId): boolean {
    return this.get(id)?.isActive === true;
  }

  public get size(): number {
    return this.#participants.size;
  }

  public values(): readonly Participant[] {
    return Object.freeze([...this.#participants.values()]);
  }

  public clone(): ParticipantRoster {
    return new ParticipantRoster(this.#participants.values());
  }
}

function hasValidParticipantIdLength(value: string): boolean {
  let length = 0;
  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) return false;
    index += codePoint > 0xffff ? 2 : 1;
    length += 1;
    if (length > MAX_PARTICIPANT_ID_LENGTH) return false;
  }
  return length > 0;
}
