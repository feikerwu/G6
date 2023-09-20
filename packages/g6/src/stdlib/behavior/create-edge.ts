import type { IG6GraphEvent } from '../../types';
import { warn } from '../../util/warn';
import { generateEdgeID } from '../../util/item';
import { Behavior } from '../../types/behavior';
import { EdgeDisplayModelData } from '../../types/edge';

const KEYBOARD_TRIGGERS = ['shift', 'ctrl', 'control', 'alt', 'meta'] as const;
const EVENT_TRIGGERS = ['click', 'drag'] as const;

const VIRTUAL_EDGE_ID = 'g6-create-edge-virtual-edge';
const DUMMY_NODE_ID = 'g6-create-edge-dummy-node';

// type Trigger = (typeof EVENT_TRIGGERS)[number];

interface CreateEdgeOptions {
  /**
   * The triggering conditions for this interaction can be either 'click' or 'drag'.
   * Default to `click`.
   */
  trigger: (typeof EVENT_TRIGGERS)[number];

  /**
   * Keyboard keys serve as auxiliary triggers for this interaction.
   * cound be 'shift', 'ctrl', 'control', 'alt', 'meta', undefined.
   */
  key?: (typeof KEYBOARD_TRIGGERS)[number];

  /**
   * Config of the created edge.
   */
  edgeConfig: EdgeDisplayModelData;
  /**
   * The event name to trigger after creating the virtual edge.
   */
  createVirtualEventName?: string;
  /**
   * The event name to trigger after creating the actual edge.
   */
  createActualEventName?: string;
  /**
   * The event name to trigger after canceling the behavior.
   */
  cancelCreateEventName?: string;
  /**
   * Whether allow the behavior happen on the current item.
   */
  shouldBegin: (event: IG6GraphEvent) => boolean;
  /**
   *
   *  Whether it is allowed to end the creation of edges under the current conditions being operated.
   */
  shouldEnd: (event: IG6GraphEvent) => boolean;
}

const DEFAULT_OPTIONS: CreateEdgeOptions = {
  trigger: 'click',
  key: undefined,
  shouldBegin: () => true,
  shouldEnd: () => false,
  edgeConfig: {},
};

export class CreateEdge extends Behavior {
  isKeyDown = false;
  addingEdge = null;
  dummyNode = null;

  constructor(options: Partial<CreateEdgeOptions>) {
    super(Object.assign({}, DEFAULT_OPTIONS, options));
    this.validateOptions(options);
  }

  validateOptions(options: Partial<CreateEdgeOptions>) {
    if (options.trigger && !EVENT_TRIGGERS.includes(options.trigger)) {
      warn({
        optionName: `create-edge.trigger`,
        shouldBe: EVENT_TRIGGERS,
        now: options.trigger,
        scope: 'behavior',
      });

      this.options.trigger = DEFAULT_OPTIONS.trigger;
    }

    if (options.key && !KEYBOARD_TRIGGERS.includes(options.key)) {
      warn({
        optionName: `create-edge.key`,
        shouldBe: KEYBOARD_TRIGGERS,
        now: options.key,
        scope: 'behavior',
      });
      this.options.key = DEFAULT_OPTIONS.key;
    }
  }

  getEvents = () => {
    const { trigger, key } = this.options;
    const [CLICK_NAME] = EVENT_TRIGGERS;

    const triggerEvents =
      trigger === CLICK_NAME
        ? {
            'node:click': this.handleCreateEdge,
            pointermove: this.updateEndPoint,
            'edge:click': this.cancelCreating,
            'canvas:click': this.cancelCreating,
            'combo:click': this.handleCreateEdge,
          }
        : {
            'node:dragstart': this.handleCreateEdge,
            'combo:dragstart': this.handleCreateEdge,
            drag: this.updateEndPoint,
            drop: this.onDrop,
          };

    const keyboardEvents = key
      ? {
          keydown: this.onKeyDown,
          keyup: this.onKeyUp,
        }
      : {};

    return { ...triggerEvents, ...keyboardEvents } as Record<
      string,
      (e: IG6GraphEvent) => void
    >;
  };

  handleCreateEdge = (e: IG6GraphEvent) => {
    if (this.options.key && !this.isKeyDown) {
      return;
    }

    if (this.options.shouldEnd(e)) {
      return;
    }

    const { graph, options, addingEdge } = this;
    const currentNodeId = e.itemId;

    const { edgeConfig, createVirtualEventName, createActualEventName } =
      options;

    if (addingEdge) {
      // create edge end, add the actual edge to graph and remove the virtual edge and node
      graph.addData('edge', {
        id: generateEdgeID(addingEdge.source, currentNodeId),
        source: addingEdge.source,
        target: currentNodeId,
        data: {
          ...edgeConfig,
          type:
            currentNodeId === addingEdge.source ? 'loop-edge' : edgeConfig.type,
        },
      });
      if (createActualEventName) {
        graph.emit(createActualEventName, { edge: addingEdge });
      }
      this.cancelCreating();

      return;
    }

    this.dummyNode = graph.addData('node', {
      id: DUMMY_NODE_ID,
      data: {
        x: e.canvas.x,
        y: e.canvas.y,
        keyShape: {
          opacity: 0,
          interactive: false,
        },
        labelShape: {
          opacity: 0,
        },
        anchorPoints: [[0.5, 0.5]],
      },
    });
    this.addingEdge = graph.addData('edge', {
      id: VIRTUAL_EDGE_ID,
      source: currentNodeId,
      target: DUMMY_NODE_ID,
      data: {
        ...edgeConfig,
      },
    });
    if (createVirtualEventName) {
      graph.emit(createVirtualEventName, { edge: this.addingEdge });
    }
  };

  onDrop = async (e: IG6GraphEvent) => {
    const { addingEdge, options, graph } = this;

    const { edgeConfig, key, createActualEventName } = options;
    if (key && !this.isKeyDown) {
      return;
    }

    if (!addingEdge) {
      return;
    }

    const elements = await this.graph.canvas.document.elementsFromPoint(
      e.canvas.x,
      e.canvas.y,
    );
    const currentIds = elements
      // @ts-ignore TODO: G type
      .map((ele) => ele.parentNode.getAttribute?.('data-item-id'))
      .filter((id) => id !== undefined && !DUMMY_NODE_ID !== id);
    const dropId = currentIds.find(
      (id) => this.graph.getComboData(id) || this.graph.getNodeData(id),
    );

    if (!dropId) {
      this.cancelCreating();
      return;
    }

    graph.addData('edge', {
      id: generateEdgeID(addingEdge.source, dropId),
      source: addingEdge.source,
      target: dropId,
      data: {
        ...edgeConfig,
        type: dropId === addingEdge.source ? 'loop-edge' : edgeConfig.type,
      },
    });
    if (createActualEventName) {
      graph.emit(createActualEventName, { edge: addingEdge });
    }
    this.cancelCreating();
  };

  updateEndPoint = (e: IG6GraphEvent) => {
    const { options, graph, addingEdge, isKeyDown } = this;
    if (options.key && !isKeyDown) {
      return;
    }

    if (!addingEdge) {
      return;
    }

    const sourceId = addingEdge.source,
      targetId = addingEdge.target;

    if (!graph.getItemById(sourceId)) {
      this.addingEdge = null;
      return;
    }

    graph.updatePosition('node', {
      id: targetId,
      data: {
        x: e.canvas.x,
        y: e.canvas.y,
      },
    });
  };

  cancelCreating = () => {
    if (this.addingEdge) {
      this.graph.removeData('edge', VIRTUAL_EDGE_ID);
      this.addingEdge = null;
    }
    if (this.dummyNode) {
      this.graph.removeData('node', DUMMY_NODE_ID);
      this.dummyNode = null;
    }
    if (this.options.cancelCreateEventName) {
      this.graph.emit(this.options.cancelCreateEventName, {});
    }
  };

  onKeyDown = (e: KeyboardEvent) => {
    const code = e.key;

    if (!code) {
      return;
    }

    if (code.toLocaleLowerCase() === this.options.key) {
      this.isKeyDown = true;
    }
  };

  onKeyUp = (e: IG6GraphEvent) => {
    if (this.addingEdge) {
      this.cancelCreating();
    }
    this.isKeyDown = false;
  };
}