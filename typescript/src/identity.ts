const MAX_REFERENCE_LENGTH = 160;

export type IdentityErrorCode =
  | 'GAME_INVALID_DEFINITION_KEY'
  | 'GAME_INVALID_DEFINITION_VERSION'
  | 'GAME_INVALID_SESSION_ID'
  | 'GAME_INVALID_RESULT_ID'
  | 'GAME_INVALID_RESULT_VERSION';

export class IdentityError extends Error {
  public override readonly name = 'IdentityError';

  public constructor(public readonly code: IdentityErrorCode) {
    super(code);
  }
}

export class GameDefinitionKey {
  private constructor(private readonly value: string) {}

  public static parse(value: string): GameDefinitionKey {
    if (!isDefinitionKey(value)) {
      throw new IdentityError('GAME_INVALID_DEFINITION_KEY');
    }
    return new GameDefinitionKey(value);
  }

  public toString(): string {
    return this.value;
  }
}

export class GameDefinitionVersion {
  private constructor(private readonly value: string) {}

  public static parse(value: string): GameDefinitionVersion {
    if (!isVersion(value)) {
      throw new IdentityError('GAME_INVALID_DEFINITION_VERSION');
    }
    return new GameDefinitionVersion(value);
  }

  public toString(): string {
    return this.value;
  }
}

export class GameDefinitionRef {
  private constructor(
    public readonly key: GameDefinitionKey,
    public readonly version: GameDefinitionVersion,
  ) {}

  public static create(key: string, version: string): GameDefinitionRef {
    return new GameDefinitionRef(
      GameDefinitionKey.parse(key),
      GameDefinitionVersion.parse(version),
    );
  }
}

export class GameSessionId {
  private constructor(private readonly value: string) {}

  public static parse(value: string): GameSessionId {
    if (!isReferenceId(value)) {
      throw new IdentityError('GAME_INVALID_SESSION_ID');
    }
    return new GameSessionId(value);
  }

  public toString(): string {
    return this.value;
  }
}

export class GameSessionRef {
  private constructor(
    public readonly definition: GameDefinitionRef,
    public readonly sessionId: GameSessionId,
  ) {}

  public static create(definition: GameDefinitionRef, sessionId: string): GameSessionRef {
    return new GameSessionRef(definition, GameSessionId.parse(sessionId));
  }
}

export class GameResultId {
  private constructor(private readonly value: string) {}

  public static parse(value: string): GameResultId {
    if (!isReferenceId(value)) {
      throw new IdentityError('GAME_INVALID_RESULT_ID');
    }
    return new GameResultId(value);
  }

  public toString(): string {
    return this.value;
  }
}

export class GameResultRef {
  private constructor(
    public readonly session: GameSessionRef,
    public readonly resultId: GameResultId,
    public readonly version: number,
  ) {}

  public static create(session: GameSessionRef, resultId: string, version: number): GameResultRef {
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new IdentityError('GAME_INVALID_RESULT_VERSION');
    }
    return new GameResultRef(session, GameResultId.parse(resultId), version);
  }
}

function isDefinitionKey(value: string): boolean {
  if (value.length === 0 || value.length > MAX_REFERENCE_LENGTH) return false;
  return value.split('.').every((segment) => /^[a-z][a-z0-9_]*$/.test(segment));
}

function isVersion(value: string): boolean {
  return (
    value.length > 0 && value.length <= MAX_REFERENCE_LENGTH && /^[A-Za-z0-9._-]+$/.test(value)
  );
}

function isReferenceId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_REFERENCE_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
