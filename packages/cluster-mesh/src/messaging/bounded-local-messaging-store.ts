import { AckOperation } from './ack-operation.js';
import type { BoundedLocalMessagingOptions } from './bounded-local-options.js';
import type {
  AckMessageRequest,
  AckMessageResult,
  ClusterMeshMessagingPort,
  PopMessageRequest,
  PopMessageResult,
  SubscribeMessagesRequest,
  SubscribeMessagesResult,
} from './delivery-contracts.js';
import { DeliveryOperation } from './delivery-operation.js';
import { DrainFenceOperation } from './drain-fence-operation.js';
import { LocalMessagingState } from './local-state.js';
import type { PutMessageRequest, PutMessageResult } from './message-contracts.js';
import type {
  NativeDrainCoordinatorPort,
  NativeDrainAcquireResult,
  NativeDrainFence,
  NativeDrainImportResult,
} from './native-drain-contracts.js';
import { NativeImportOperation } from './native-import-operation.js';
import type {
  MessageTopicRoutePort,
  MessagingProductAuthorizationPort,
} from './product-authorization.js';
import { PutOperation } from './put-operation.js';
import { SubscriptionOperation } from './subscription-operation.js';

export class BoundedLocalMessagingStore
implements ClusterMeshMessagingPort, NativeDrainCoordinatorPort {
  private readonly puts: PutOperation;
  private readonly deliveries: DeliveryOperation;
  private readonly acknowledgements: AckOperation;
  private readonly subscriptions: SubscriptionOperation;
  private readonly fences: DrainFenceOperation;
  private readonly imports: NativeImportOperation;

  constructor(input: {
    readonly options: BoundedLocalMessagingOptions;
    readonly authorization: MessagingProductAuthorizationPort;
    readonly routes: MessageTopicRoutePort;
  }) {
    const state = new LocalMessagingState(input.options);
    this.puts = new PutOperation(state, input.authorization, input.routes);
    this.deliveries = new DeliveryOperation(state, input.authorization);
    this.acknowledgements = new AckOperation(state, input.authorization);
    this.subscriptions = new SubscriptionOperation(
      state, input.authorization, this.deliveries,
    );
    this.fences = new DrainFenceOperation(state);
    this.imports = new NativeImportOperation(state, this.puts);
  }

  put(input: PutMessageRequest): Promise<PutMessageResult> {
    return this.puts.put(input);
  }

  pop(input: PopMessageRequest): Promise<PopMessageResult> {
    return this.deliveries.pop(input);
  }

  subscribe(input: SubscribeMessagesRequest): Promise<SubscribeMessagesResult> {
    return this.subscriptions.subscribe(input);
  }

  ack(input: AckMessageRequest): Promise<AckMessageResult> {
    return this.acknowledgements.ack(input);
  }

  acquire(
    input: Parameters<NativeDrainCoordinatorPort['acquire']>[0],
  ): Promise<NativeDrainAcquireResult> {
    return this.fences.acquire(input);
  }

  renew(
    input: Parameters<NativeDrainCoordinatorPort['renew']>[0],
  ): Promise<NativeDrainFence | null> {
    return this.fences.renew(input);
  }

  importBatch(
    input: Parameters<NativeDrainCoordinatorPort['importBatch']>[0],
  ): Promise<NativeDrainImportResult> {
    return this.imports.importBatch(input);
  }

  release(input: Parameters<NativeDrainCoordinatorPort['release']>[0]): Promise<boolean> {
    return this.fences.release(input);
  }
}
