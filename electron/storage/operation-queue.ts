export class SerializedOperationQueue {
  private tail = Promise.resolve()

  public run<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}
