export type QueueOperation = 'enqueue' | 'dequeue' | 'remove' | 'popAll';

export type QueueOperationMessage = {
  type: 'queue-operation';
  operation: QueueOperation;
  timestamp: string;
  sessionId: string;
  content?: string;
};
