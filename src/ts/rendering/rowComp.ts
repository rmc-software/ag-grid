import {Utils as _} from "../utils";
import {CellComp, ICellComp} from "./cellComp";
import {RowNode} from "../entities/rowNode";
import {GridOptionsWrapper} from "../gridOptionsWrapper";
import {RowRenderer} from "./rowRenderer";
import {Column} from "../entities/column";
import {
    Events,
    RowClickedEvent,
    RowDoubleClickedEvent,
    RowEditingStartedEvent,
    RowEditingStoppedEvent,
    RowEvent,
    RowValueChangedEvent,
    VirtualRowRemovedEvent
} from "../events";
import {EventService} from "../eventService";
import {Autowired} from "../context/context";
import {Constants} from "../constants";
import {CellRendererFactory} from "./cellRendererFactory";
import {ICellRendererComp, ICellRendererFunc, ICellRendererParams} from "./cellRenderers/iCellRenderer";
import {BeanStub} from "../context/beanStub";
import {RowContainerComponent} from "./rowContainerComponent";
import {Component} from "../widgets/component";
import {RefSelector} from "../widgets/componentAnnotations";
import {Beans} from "./beans";

class TempStubCell extends Component {

    private static TEMPLATE =
        `<div class="ag-stub-cell">
            <span class="ag-loading-icon" ref="eLoadingIcon"></span>
            <span class="ag-loading-text" ref="eLoadingText"></span>
        </div>`;

    @Autowired('gridOptionsWrapper') gridOptionsWrapper: GridOptionsWrapper;

    @RefSelector('eLoadingIcon') private eLoadingIcon: HTMLElement;
    @RefSelector('eLoadingText') private eLoadingText: HTMLElement;

    constructor() {
        super(TempStubCell.TEMPLATE);
    }

    public init(params: ICellRendererParams): void {
        let eLoadingIcon = _.createIconNoSpan('groupLoading', this.gridOptionsWrapper, null);
        this.eLoadingIcon.appendChild(eLoadingIcon);

        let localeTextFunc = this.gridOptionsWrapper.getLocaleTextFunc();
        this.eLoadingText.innerText = localeTextFunc('loadingOoo', 'Loading');
    }

    public refresh(params: any): boolean {
        return false;
    }
}

// used when we want to ensure order in the DOM - for accessibility reasons.
// when inserting element, we go from left to right, and this object keeps
// track of the last inserted element, so the next element can be placed
// beside it.
export interface LastPlacedElements {
    eLeft: HTMLElement;
    eRight: HTMLElement;
    eBody: HTMLElement;
    eFullWidth: HTMLElement;
}

export interface IRowComp {
    addEventListener(eventType: string, listener: Function): void;
    destroy(): void;
    ensureInDomAfter(previousElement: LastPlacedElements): void;
    getBodyRowElement(): HTMLElement;
    getPinnedLeftRowElement(): HTMLElement;
    getPinnedRightRowElement(): HTMLElement;
    getFullWidthRowElement(): HTMLElement;
    getRowNode(): RowNode;
    getRenderedCellForColumn(column: Column): ICellComp;
    getAndClearNextVMTurnFunctions(): Function[];
    isEditing(): boolean;
    init(): void;
    onMouseEvent(eventName: string, mouseEvent: MouseEvent): void;
    forEachCellComp(callback: (renderedCell: ICellComp)=>void): void;
    stopEditing(cancel?: boolean): void;
    startRowEditing(keyPress?: number, charPress?: string, sourceRenderedCell?: CellComp): void;
    stopRowEditing(cancel: boolean): void;
    destroy(animate?: boolean): void;
    getAndClearDelayedDestroyFunctions(): Function[];
}

export class RowComp extends BeanStub implements IRowComp {

    public static EVENT_ROW_REMOVED = 'rowRemoved';

    public static DOM_DATA_KEY_RENDERED_ROW = 'renderedRow';

    private beans: Beans;

    private ePinnedLeftRow: HTMLElement;
    private ePinnedRightRow: HTMLElement;
    private eBodyRow: HTMLElement;

    private eFullWidthRow: HTMLElement;
    private eFullWidthRowBody: HTMLElement;
    private eFullWidthRowLeft: HTMLElement;
    private eFullWidthRowRight: HTMLElement;

    private eAllRowContainers: HTMLElement[] = [];

    private fullWidthRowComponent: ICellRendererComp;
    private fullWidthRowComponentBody: ICellRendererComp;
    private fullWidthRowComponentLeft: ICellRendererComp;
    private fullWidthRowComponentRight: ICellRendererComp;

    private renderedCells: {[key: string]: CellComp} = {};
    private scope: any;
    private rowNode: RowNode;

    private fullWidthRow: boolean;
    private fullWidthCellRenderer: {new(): ICellRendererComp} | ICellRendererFunc | string;
    private fullWidthCellRendererParams: any;

    private parentScope: any;
    private rowRenderer: RowRenderer;

    private bodyContainerComp: RowContainerComponent;
    private fullWidthContainerComp: RowContainerComponent;
    private pinnedLeftContainerComp: RowContainerComponent;
    private pinnedRightContainerComp: RowContainerComponent;

    private fullWidthPinnedLeftLastTime: boolean;
    private fullWidthPinnedRightLastTime: boolean;

    // for animations, there are bits we want done in the next VM turn, to all DOM to update first.
    // instead of each row doing a setTimeout(func,0), we put the functions here and the rowRenderer
    // executes them all in one timeout
    private nextVmTurnFunctions: Function[] = [];

    // for animations, these functions get called 400ms after the row is cleared, called by the rowRenderer
    // so each row isn't setting up it's own timeout
    private delayedDestroyFunctions: Function[] = [];

    // these get called before the row is destroyed - they set up the DOM for the remove animation (ie they
    // set the DOM up for the animation), then the delayedDestroyFunctions get called when the animation is
    // complete (ie removes from the dom).
    private startRemoveAnimationFunctions: Function[] = [];

    private renderedRowEventService: EventService;

    private editingRow = false;

    private initialised = false;

    private animateIn: boolean;

    private rowFocusedLastTime: boolean;

    private lastPlacedElements: LastPlacedElements;

    private forPrint: boolean;

    constructor(parentScope: any,
                rowRenderer: RowRenderer,
                bodyContainerComp: RowContainerComponent,
                fullWidthContainerComp: RowContainerComponent,
                pinnedLeftContainerComp: RowContainerComponent,
                pinnedRightContainerComp: RowContainerComponent,
                node: RowNode,
                animateIn: boolean,
                lastPlacedElements: LastPlacedElements,
                beans: Beans) {
        super();
        this.parentScope = parentScope;
        this.rowRenderer = rowRenderer;

        this.bodyContainerComp = bodyContainerComp;
        this.fullWidthContainerComp = fullWidthContainerComp;
        this.pinnedLeftContainerComp = pinnedLeftContainerComp;
        this.pinnedRightContainerComp = pinnedRightContainerComp;

        this.rowNode = node;
        this.animateIn = animateIn;
        this.lastPlacedElements = lastPlacedElements;

        this.beans = beans;
    }

    private setupRowStub(animateInRowTop: boolean): void {
        this.fullWidthRow = true;
        this.fullWidthCellRenderer = TempStubCell;

        if (_.missing(this.fullWidthCellRenderer)) {
            console.warn(`ag-Grid: you need to provide a fullWidthCellRenderer if using isFullWidthCell()`);
        }

        this.createFullWidthRow(animateInRowTop);
    }

    private setupRowContainers(animateInRowTop: boolean): void {

        // fixme: hack - to get loading working for Enterprise Model
        if (this.rowNode.stub) {
            this.setupRowStub(animateInRowTop);
            return;
        }

        let isFullWidthCellFunc = this.beans.gridOptionsWrapper.getIsFullWidthCellFunc();
        let isFullWidthCell = isFullWidthCellFunc ? isFullWidthCellFunc(this.rowNode) : false;
        let isGroupSpanningRow = this.rowNode.group && this.beans.gridOptionsWrapper.isGroupUseEntireRow();

        if (isFullWidthCell) {
            this.setupFullWidthContainers(animateInRowTop);
        } else if (isGroupSpanningRow) {
            this.setupFullWidthGroupContainers(animateInRowTop);
        } else {
            this.setupNormalContainers(animateInRowTop);
        }
    }

    // we clear so that the functions are never executed twice
    public getAndClearDelayedDestroyFunctions(): Function[] {
        let result = this.delayedDestroyFunctions;
        this.delayedDestroyFunctions = [];
        return result;
    }

    // we clear so that the functions are never executed twice
    public getAndClearNextVMTurnFunctions(): Function[] {
        let result = this.nextVmTurnFunctions;
        this.nextVmTurnFunctions = [];
        return result;
    }

    private addDomData(eRowContainer: Element): void {

        this.beans.gridOptionsWrapper.setDomData(eRowContainer, RowComp.DOM_DATA_KEY_RENDERED_ROW, this);

        this.addDestroyFunc( ()=> {
            this.beans.gridOptionsWrapper.setDomData(eRowContainer, RowComp.DOM_DATA_KEY_RENDERED_ROW, null) }
        );
    }

    public ensureInDomAfter(previousElement: LastPlacedElements): void {
        if (_.missing(previousElement)) { return; }

        let body = this.getBodyRowElement();
        if (body) {
            this.bodyContainerComp.ensureDomOrder(body, previousElement.eBody);
        }

        let left = this.getPinnedLeftRowElement();
        if (left) {
            this.pinnedLeftContainerComp.ensureDomOrder(left, previousElement.eLeft);
        }

        let right = this.getPinnedRightRowElement();
        if (right) {
            this.pinnedRightContainerComp.ensureDomOrder(right, previousElement.eRight);
        }

        let fullWidth = this.getFullWidthRowElement();
        if (fullWidth) {
            this.fullWidthContainerComp.ensureDomOrder(fullWidth, previousElement.eFullWidth);
        }
    }

    private setupFullWidthContainers(animateInRowTop: boolean): void {
        this.fullWidthRow = true;
        this.fullWidthCellRenderer = this.beans.gridOptionsWrapper.getFullWidthCellRenderer();
        this.fullWidthCellRendererParams = this.beans.gridOptionsWrapper.getFullWidthCellRendererParams();
        if (_.missing(this.fullWidthCellRenderer)) {
            console.warn(`ag-Grid: you need to provide a fullWidthCellRenderer if using isFullWidthCell()`);
        }

        this.createFullWidthRow(animateInRowTop);
    }

    private addMouseWheelListenerToFullWidthRow(): void {
        let mouseWheelListener = this.beans.gridPanel.genericMouseWheelListener.bind(this.beans.gridPanel);
        // IE9, Chrome, Safari, Opera
        this.addDestroyableEventListener(this.eFullWidthRow, 'mousewheel', mouseWheelListener);
        // Firefox
        this.addDestroyableEventListener(this.eFullWidthRow, 'DOMMouseScroll', mouseWheelListener);
    }

    private setupFullWidthGroupContainers(animateInRowTop: boolean): void {
        this.fullWidthRow = true;
        this.fullWidthCellRenderer = this.beans.gridOptionsWrapper.getGroupRowRenderer();
        this.fullWidthCellRendererParams = this.beans.gridOptionsWrapper.getGroupRowRendererParams();

        if (!this.fullWidthCellRenderer) {
            this.fullWidthCellRenderer = CellRendererFactory.GROUP;
            this.fullWidthCellRendererParams = {
                innerRenderer: this.beans.gridOptionsWrapper.getGroupRowInnerRenderer()
            };
        }

        this.createFullWidthRow(animateInRowTop);
    }

    private createFullWidthRow(animateInRowTop: boolean): void {
        let embedFullWidthRows = this.beans.gridOptionsWrapper.isEmbedFullWidthRows();

        let ensureDomOrder = _.exists(this.lastPlacedElements);

        if (embedFullWidthRows) {

            // if embedding the full width, it gets added to the body, left and right
            let previousBody = ensureDomOrder ? this.lastPlacedElements.eBody : null;
            let previousLeft = ensureDomOrder ? this.lastPlacedElements.eLeft : null;
            let previousRight = ensureDomOrder ? this.lastPlacedElements.eRight : null;

            this.eFullWidthRowBody = this.createRowContainer(this.bodyContainerComp, animateInRowTop, previousBody, ensureDomOrder);
            this.eFullWidthRowLeft = this.createRowContainer(this.pinnedLeftContainerComp, animateInRowTop, previousLeft, ensureDomOrder);
            this.eFullWidthRowRight = this.createRowContainer(this.pinnedRightContainerComp, animateInRowTop, previousRight, ensureDomOrder);

            _.addCssClass(this.eFullWidthRowLeft, 'ag-cell-last-left-pinned');
            _.addCssClass(this.eFullWidthRowRight, 'ag-cell-first-right-pinned');

        } else {

            // otherwise we add to the fullWidth container as normal
            let previousFullWidth = ensureDomOrder ? this.lastPlacedElements.eFullWidth : null;
            this.eFullWidthRow = this.createRowContainer(this.fullWidthContainerComp, animateInRowTop, previousFullWidth, ensureDomOrder);

            // and fake the mouse wheel for the fullWidth container
            if (!this.beans.gridOptionsWrapper.isForPrint()) {
                this.addMouseWheelListenerToFullWidthRow();
            }
        }
    }

    private setupNormalContainers(animateInRowTop: boolean): void {
        this.fullWidthRow = false;

        let ensureDomOrder = _.exists(this.lastPlacedElements);

        let previousBody = ensureDomOrder ? this.lastPlacedElements.eBody : null;
        let previousLeft = ensureDomOrder ? this.lastPlacedElements.eLeft : null;
        let previousRight = ensureDomOrder ? this.lastPlacedElements.eRight : null;

        this.eBodyRow = this.createRowContainer(this.bodyContainerComp, animateInRowTop, previousBody, ensureDomOrder);

        if (!this.beans.gridOptionsWrapper.isForPrint()) {
            this.ePinnedLeftRow = this.createRowContainer(this.pinnedLeftContainerComp, animateInRowTop, previousLeft, ensureDomOrder);
            this.ePinnedRightRow = this.createRowContainer(this.pinnedRightContainerComp, animateInRowTop, previousRight, ensureDomOrder);
        }
    }

    public init(): void {

        this.forPrint = this.beans.gridOptionsWrapper.isForPrint();

        let animateInRowTop = this.animateIn && _.exists(this.rowNode.oldRowTop);
        
        this.setupRowContainers(animateInRowTop);

        this.scope = this.createChildScopeOrNull(this.rowNode.data);

        if (this.fullWidthRow) {
            this.refreshFullWidthComponent();
        } else {
            this.refreshCellsIntoRow();
        }

        this.addGridClasses();
        this.addExpandedAndContractedClasses();

        this.addStyleFromRowStyle();
        this.addStyleFromRowStyleFunc();

        this.addClassesFromRowClass();
        this.addClassesFromRowClassFunc();

        this.addRowIndexes();
        this.addRowIds();
        this.setupTop(animateInRowTop);
        this.setHeight();

        this.addRowSelectedListener();
        this.addCellFocusedListener();
        this.addNodeDataChangedListener();
        this.addColumnListener();

        this.addHoverFunctionality();

        this.beans.gridOptionsWrapper.executeProcessRowPostCreateFunc({
            eRow: this.eBodyRow,
            ePinnedLeftRow: this.ePinnedLeftRow,
            ePinnedRightRow: this.ePinnedRightRow,
            node: this.rowNode,
            api: this.beans.gridOptionsWrapper.getApi(),
            rowIndex: this.rowNode.rowIndex,
            addRenderedRowListener: this.addEventListener.bind(this),
            columnApi: this.beans.gridOptionsWrapper.getColumnApi(),
            context: this.beans.gridOptionsWrapper.getContext()
        });

        this.initialised = true;
    }

    public stopRowEditing(cancel: boolean): void {
        this.stopEditing(cancel);
    }

    public isEditing(): boolean {
        if (this.beans.gridOptionsWrapper.isFullRowEdit()) {
            // if doing row editing, then the local variable is the one that is used
            return this.editingRow;
        } else {
            // if not doing row editing, then the renderedRow has no edit state, so
            // we have to look at the individual cells
            let editingCell = _.find(this.renderedCells, renderedCell => renderedCell && renderedCell.isEditing() );
            return _.exists(editingCell);
        }
    }

    public stopEditing(cancel = false): void {
        this.forEachCellComp(renderedCell => {
            renderedCell.stopEditing(cancel);
        });
        if (this.editingRow) {
            if (!cancel) {
                let event: RowValueChangedEvent = this.createRowEvent(Events.EVENT_ROW_VALUE_CHANGED);
                this.beans.eventService.dispatchEvent(event);
            }
            this.setEditingRow(false);
        }
    }

    private createRowEvent(type: string, domEvent?: Event): RowEvent {
        return {
            type: type,
            node: this.rowNode,
            data: this.rowNode.data,
            rowIndex: this.rowNode.rowIndex,
            rowPinned: this.rowNode.rowPinned,
            context: this.beans.gridOptionsWrapper.getContext(),
            api: this.beans.gridOptionsWrapper.getApi(),
            columnApi: this.beans.gridOptionsWrapper.getColumnApi(),
            event: domEvent
        }
    }

    public startRowEditing(keyPress: number = null, charPress: string = null, sourceRenderedCell: CellComp = null): void {
        // don't do it if already editing
        if (this.editingRow) { return; }

        this.forEachCellComp(renderedCell => {
            let cellStartedEdit = renderedCell === sourceRenderedCell;
            if (cellStartedEdit) {
                renderedCell.startEditingIfEnabled(keyPress, charPress, cellStartedEdit)
            } else {
                renderedCell.startEditingIfEnabled(null, null, cellStartedEdit)
            }
        });
        this.setEditingRow(true);
    }

    private setEditingRow(value: boolean): void {
        this.editingRow = value;
        this.eAllRowContainers.forEach( (row) => _.addOrRemoveCssClass(row, 'ag-row-editing', value) );

        let event: RowEvent = value ?
            <RowEditingStartedEvent> this.createRowEvent(Events.EVENT_ROW_EDITING_STARTED)
            : <RowEditingStoppedEvent> this.createRowEvent(Events.EVENT_ROW_EDITING_STOPPED);

        this.beans.eventService.dispatchEvent(event);
    }

    private angular1Compile(element: Element): void {
        if (this.scope) {
            this.beans.$compile(element)(this.scope);
        }
    }

    private addColumnListener(): void {
        let eventService = this.beans.eventService;
        this.addDestroyableEventListener(eventService, Events.EVENT_DISPLAYED_COLUMNS_CHANGED, this.onDisplayedColumnsChanged.bind(this));
        this.addDestroyableEventListener(eventService, Events.EVENT_VIRTUAL_COLUMNS_CHANGED, this.onVirtualColumnsChanged.bind(this));
        this.addDestroyableEventListener(eventService, Events.EVENT_COLUMN_RESIZED, this.onDisplayedColumnsChanged.bind(this));
        this.addDestroyableEventListener(eventService, Events.EVENT_GRID_COLUMNS_CHANGED, this.onGridColumnsChanged.bind(this));
    }

    private onDisplayedColumnsChanged(): void {
        // if row is a group row that spans, then it's not impacted by column changes, with exception of pinning
        if (this.fullWidthRow) {
            if (this.beans.gridOptionsWrapper.isEmbedFullWidthRows()) {
                let leftMismatch = this.fullWidthPinnedLeftLastTime !== this.beans.columnController.isPinningLeft();
                let rightMismatch = this.fullWidthPinnedRightLastTime !== this.beans.columnController.isPinningRight();
                // if either of the pinned panels has shown / hidden, then need to redraw the fullWidth bits when
                // embedded, as what appears in each section depends on whether we are pinned or not
                if (leftMismatch || rightMismatch) {
                    this.refreshFullWidthComponent();
                }
            } else {
                // otherwise nothing, the floating fullWidth containers are not impacted by column changes
            }
        } else {
            this.refreshCellsIntoRow();
        }
    }

    private onVirtualColumnsChanged(): void {
        // if row is a group row that spans, then it's not impacted by column changes, with exception of pinning
        if (!this.fullWidthRow) {
            this.refreshCellsIntoRow();
        }
    }

    // when grid columns change, then all cells should be cleaned out,
    // as the new columns could have same id as the previous columns and may conflict
    private onGridColumnsChanged(): void {
        let allRenderedCellIds = Object.keys(this.renderedCells);
        this.removeRenderedCells(allRenderedCellIds);
    }

    private isCellInWrongRow(renderedCell: CellComp): boolean {
        let column = renderedCell.getColumn();
        let rowWeWant = this.getContainerForCell(column.getPinned());

        // if in wrong container, remove it
        let oldRow = renderedCell.getParentRow();
        return oldRow !== rowWeWant;
    }

    // method makes sure the right cells are present, and are in the right container. so when this gets called for
    // the first time, it sets up all the cells. but then over time the cells might appear / dissappear or move
    // container (ie into pinned)
    private refreshCellsIntoRow() {
        let centerCols = this.beans.columnController.getAllDisplayedCenterVirtualColumnsForRow(this.rowNode);
        let leftCols = this.beans.columnController.getDisplayedLeftColumnsForRow(this.rowNode);
        let rightCols = this.beans.columnController.getDisplayedRightColumnsForRow(this.rowNode);

        let cellsToRemove = Object.keys(this.renderedCells);

        let ensureDomOrder = this.beans.gridOptionsWrapper.isEnsureDomOrder() && !this.forPrint;
        let lastPlacedCells: LastPlacedElements = ensureDomOrder ? {eLeft: null, eRight: null, eBody: null, eFullWidth: null} : null;

        let addColFunc = (column: Column) => {
            let renderedCell = this.getOrCreateCell(column);
            this.ensureCellInCorrectContainer(renderedCell, lastPlacedCells);
            _.removeFromArray(cellsToRemove, column.getColId());
        };

        centerCols.forEach(addColFunc);
        leftCols.forEach(addColFunc);
        rightCols.forEach(addColFunc);

        // we never remove editing cells, as this would cause the cells to loose their values while editing
        // as the grid is scrolling horizontally.
        cellsToRemove = _.filter(cellsToRemove, this.isCellEligibleToBeRemoved.bind(this));

        // remove old cells from gui, but we don't destroy them, we might use them again
        this.removeRenderedCells(cellsToRemove);
    }

    private isCellEligibleToBeRemoved(indexStr: string): boolean {
        let displayedColumns = this.beans.columnController.getAllDisplayedColumns();

        let REMOVE_CELL : boolean = true;
        let KEEP_CELL : boolean = false;
        let renderedCell = this.renderedCells[indexStr];

        if (!renderedCell) { return REMOVE_CELL; }

        // always remove the cell if it's in the wrong pinned location
        if (this.isCellInWrongRow(renderedCell)) { return REMOVE_CELL; }

        // we want to try and keep editing and focused cells
        let editing = renderedCell.isEditing();
        let focused = this.beans.focusedCellController.isCellFocused(renderedCell.getGridCell());

        let mightWantToKeepCell = editing || focused;

        if (mightWantToKeepCell) {
            let column = renderedCell.getColumn();
            let cellStillDisplayed = displayedColumns.indexOf(column) >= 0;
            return cellStillDisplayed ? KEEP_CELL : REMOVE_CELL;
        } else {
            return REMOVE_CELL;
        }
    }

    private removeRenderedCells(colIds: string[]): void {
        colIds.forEach( (key: string)=> {
            let renderedCell = this.renderedCells[key];
            // could be old reference, ie removed cell
            if (_.missing(renderedCell)) { return; }

            renderedCell.destroy();
            this.renderedCells[key] = null;
        });
    }

    private getContainerForCell(pinnedType: string): HTMLElement {
        switch (pinnedType) {
            case Column.PINNED_LEFT: return this.ePinnedLeftRow;
            case Column.PINNED_RIGHT: return this.ePinnedRightRow;
            default: return this.eBodyRow;
        }
    }

    private ensureCellInCorrectContainer(cellComp: CellComp, lastPlacedCells: LastPlacedElements): void {
        let eCell = cellComp.getGui();
        let column = cellComp.getColumn();
        let pinnedType = column.getPinned();
        let eContainer = this.getContainerForCell(pinnedType);

        // need to check the logic around this to see if there is in fact a performance gain.
        // the reason for introducing it was to have a 'quick path' for the first time
        // if (firstTime) {
        //     eContainer.appendChild(eCell);
        //     cellComp.setParentRow(eContainer);
        //     return;
        // }

        let eCellBefore = this.getLastPlacedCell(lastPlacedCells, pinnedType);

        let forcingOrder = _.exists(lastPlacedCells);

        // if in wrong container, remove it
        let eOldContainer = cellComp.getParentRow();
        let inWrongRow = eOldContainer !== eContainer;
        if (inWrongRow) {
            // take out from old row
            if (eOldContainer) {
                eOldContainer.removeChild(eCell);
            }

            if (forcingOrder) {
                _.insertWithDomOrder(eContainer, eCell, eCellBefore);
            } else {
                eContainer.appendChild(eCell);
            }

            cellComp.setParentRow(eContainer);
        } else {
            // ensure it is in the right order
            if (forcingOrder) {
                _.ensureDomOrder(eContainer, eCell, eCellBefore);
            }
        }

        this.addToLastPlacedCells(eCell, lastPlacedCells, pinnedType);
    }

    private getLastPlacedCell(lastPlacedCells: LastPlacedElements, pinned: string): HTMLElement {
        if (!lastPlacedCells) { return null; }
        switch (pinned) {
            case Column.PINNED_LEFT: return lastPlacedCells.eLeft;
            case Column.PINNED_RIGHT: return lastPlacedCells.eRight;
            default: return lastPlacedCells.eBody;
        }
    }

    private addToLastPlacedCells(eCell: HTMLElement, lastPlacedCells: LastPlacedElements, pinned: string): void {
        if (!lastPlacedCells) { return; }
        switch (pinned) {
            case Column.PINNED_LEFT:
                lastPlacedCells.eLeft = eCell;
                break;
            case Column.PINNED_RIGHT:
                lastPlacedCells.eRight = eCell;
                break;
            default:
                lastPlacedCells.eBody = eCell;
                break;
        }
    }

    private getOrCreateCell(column: Column): CellComp {

        let colId = column.getColId();
        if (this.renderedCells[colId]) {
            return this.renderedCells[colId];
        } else {
            let cellComp = new CellComp(column, this.rowNode, this.scope, this, this.beans);
            cellComp.init();
            this.renderedCells[colId] = cellComp;
            this.angular1Compile(cellComp.getGui());

            // if we are editing the row, then the cell needs to turn
            // into edit mode
            if (this.editingRow) {
                cellComp.startEditingIfEnabled();
            }

            return cellComp;
        }
    }

    private onRowSelected(): void {
        let selected = this.rowNode.isSelected();
        this.eAllRowContainers.forEach( (row) => _.addOrRemoveCssClass(row, 'ag-row-selected', selected) );
    }

    private addRowSelectedListener(): void {
        this.addDestroyableEventListener(this.rowNode, RowNode.EVENT_ROW_SELECTED, this.onRowSelected.bind(this));
    }

    public onMouseEvent(eventName: string, mouseEvent: MouseEvent): void {
        switch (eventName) {
            case 'dblclick': this.onRowDblClick(mouseEvent); break;
            case 'click': this.onRowClick(mouseEvent); break;
        }
    }

    private addHoverFunctionality(): void {

        // because we are adding listeners to the row, we give the user the choice to not add
        // the hover class, as it slows things down, especially in IE, when you add listeners
        // to each row. we cannot do the trick of adding one listener to the GridPanel (like we
        // do for other mouse events) as these events don't propagate
        if (!this.beans.gridOptionsWrapper.isRowHoverClass()) { return; }

        let onGuiMouseEnter = this.rowNode.onMouseEnter.bind(this.rowNode);
        let onGuiMouseLeave = this.rowNode.onMouseLeave.bind(this.rowNode);
        
        this.eAllRowContainers.forEach( eRow => {
            this.addDestroyableEventListener(eRow, 'mouseenter', onGuiMouseEnter);
            this.addDestroyableEventListener(eRow, 'mouseleave', onGuiMouseLeave);
        });

        let onNodeMouseEnter = this.addHoverClass.bind(this, true);
        let onNodeMouseLeave = this.addHoverClass.bind(this, false);

        this.addDestroyableEventListener(this.rowNode, RowNode.EVENT_MOUSE_ENTER, onNodeMouseEnter);
        this.addDestroyableEventListener(this.rowNode, RowNode.EVENT_MOUSE_LEAVE, onNodeMouseLeave);
    }
    
    private addHoverClass(hover: boolean): void {
        this.eAllRowContainers.forEach( eRow => _.addOrRemoveCssClass(eRow, 'ag-row-hover', hover) );
    }

    private setRowFocusClasses(): void {
        let rowFocused = this.beans.focusedCellController.isRowFocused(this.rowNode.rowIndex, this.rowNode.rowPinned);
        if (rowFocused !== this.rowFocusedLastTime) {
            this.eAllRowContainers.forEach( (row) => _.addOrRemoveCssClass(row, 'ag-row-focus', rowFocused) );
            this.eAllRowContainers.forEach( (row) => _.addOrRemoveCssClass(row, 'ag-row-no-focus', !rowFocused) );
            this.rowFocusedLastTime = rowFocused;
        }

        if (!rowFocused && this.editingRow) {
            this.stopEditing(false);
        }
    }

    private addCellFocusedListener(): void {
        this.addDestroyableEventListener(this.beans.eventService, Events.EVENT_CELL_FOCUSED, this.setRowFocusClasses.bind(this));
        this.addDestroyableEventListener(this.beans.eventService, Events.EVENT_PAGINATION_CHANGED, this.onPaginationChanged.bind(this));
        this.addDestroyableEventListener(this.rowNode, RowNode.EVENT_ROW_INDEX_CHANGED, this.setRowFocusClasses.bind(this));
        this.setRowFocusClasses();
    }

    private onPaginationChanged(): void {
        // it is possible this row is in the new page, but the page number has changed, which means
        // it needs to reposition itself relative to the new page
        this.onTopChanged();
    }

    public forEachCellComp(callback: (renderedCell: ICellComp)=>void): void {
        _.iterateObject(this.renderedCells, (key: any, renderedCell: ICellComp)=> {
            if (renderedCell) {
                callback(renderedCell);
            }
        });
    }

    private onNodeDataChanged(event: any): void {
        // if this is an update, we want to refresh, as this will allow the user to put in a transition
        // into the cellRenderer refresh method. otherwise this might be completely new data, in which case
        // we will want to completely replace the cells
        this.forEachCellComp(cellComp =>
            cellComp.refreshCell({
                suppressFlash: !event.update,
                newData: !event.update
            })
        );

        // check for selected also, as this could be after lazy loading of the row data, in which case
        // the id might of just gotten set inside the row and the row selected state may of changed
        // as a result. this is what happens when selected rows are loaded in virtual pagination.
        // - niall note - since moving to the stub component, this may no longer be true, as replacing
        // the stub component now replaces the entire row
        this.onRowSelected();

        // as data has changed, then the style and class needs to be recomputed
        this.addStyleFromRowStyleFunc();
        this.addClassesFromRowClass();
    }

    private addNodeDataChangedListener(): void {
        this.addDestroyableEventListener(this.rowNode, RowNode.EVENT_DATA_CHANGED, this.onNodeDataChanged.bind(this));
    }

    private onTopChanged(): void {
        // top is not used in forPrint, as the rows are just laid out naturally
        let doNotSetRowTop = this.beans.gridOptionsWrapper.isForPrint() || this.beans.gridOptionsWrapper.isAutoHeight();
        if (doNotSetRowTop) { return; }

        // console.log(`top changed for ${this.rowNode.id} = ${this.rowNode.rowTop}`);
        this.setRowTop(this.rowNode.rowTop);
    }
    
    private setRowTop(pixels: number): void {
        // need to make sure rowTop is not null, as this can happen if the node was once
        // visible (ie parent group was expanded) but is now not visible
        if (_.exists(pixels)) {

            let pixelsWithOffset: number;
            if (this.rowNode.isRowPinned()) {
                pixelsWithOffset = pixels;
            } else {
                pixelsWithOffset = pixels - this.beans.paginationProxy.getPixelOffset();
            }

            let topPx = pixelsWithOffset + "px";
            this.eAllRowContainers.forEach( row => row.style.top = topPx);
        }
    }
    
    private setupTop(animateInRowTop: boolean): void {
        if (this.beans.gridOptionsWrapper.isForPrint()) { return; }

        let topChangedListener = this.onTopChanged.bind(this);

        this.addDestroyableEventListener(this.rowNode, RowNode.EVENT_TOP_CHANGED, topChangedListener);

        if (!animateInRowTop) {
            this.onTopChanged();
        }
    }
    
    private setHeight(): void {
        let setHeightListener = () => {
            // check for exists first - if the user is resetting the row height, then
            // it will be null (or undefined) momentarily until the next time the flatten
            // stage is called where the row will then update again with a new height
            if (_.exists(this.rowNode.rowHeight)) {
                let heightPx = this.rowNode.rowHeight + 'px';
                this.eAllRowContainers.forEach( row => row.style.height = heightPx);
            }
        };

        this.addDestroyableEventListener(this.rowNode, RowNode.EVENT_HEIGHT_CHANGED, setHeightListener);

        setHeightListener();
    }

    private addRowIndexes(): void {
        let rowIndexListener = () => {
            let rowStr = this.rowNode.rowIndex.toString();
            if (this.rowNode.rowPinned===Constants.PINNED_BOTTOM) {
                rowStr = 'fb-' + rowStr;
            } else if (this.rowNode.rowPinned===Constants.PINNED_TOP) {
                rowStr = 'ft-' + rowStr;
            }
            this.eAllRowContainers.forEach( eRow => {
                eRow.setAttribute('row', rowStr);

                let rowIsEven = this.rowNode.rowIndex % 2 === 0;
                _.addOrRemoveCssClass(eRow, 'ag-row-even', rowIsEven);
                _.addOrRemoveCssClass(eRow, 'ag-row-odd', !rowIsEven);
            } );
        };

        this.addDestroyableEventListener(this.rowNode, RowNode.EVENT_ROW_INDEX_CHANGED, rowIndexListener);

        rowIndexListener();
    }

    // adds in row and row-id attributes to the row
    private addRowIds(): void {
        if (typeof this.beans.gridOptionsWrapper.getBusinessKeyForNodeFunc() === 'function') {
            let businessKey = this.beans.gridOptionsWrapper.getBusinessKeyForNodeFunc()(this.rowNode);
            if (typeof businessKey === 'string' || typeof businessKey === 'number') {
                this.eAllRowContainers.forEach( row => row.setAttribute('row-id', businessKey) );
            }
        }
    }

    public addEventListener(eventType: string, listener: Function): void {
        if (eventType==='renderedRowRemoved') {
            eventType = RowComp.EVENT_ROW_REMOVED;
            console.warn('ag-Grid: Since version 11, event renderedRowRemoved is now called ' + RowComp.EVENT_ROW_REMOVED);
        }
        if (!this.renderedRowEventService) { this.renderedRowEventService = new EventService(); }
        this.renderedRowEventService.addEventListener(eventType, listener);
    }

    public removeEventListener(eventType: string, listener: Function): void {
        if (eventType==='renderedRowRemoved') {
            eventType = RowComp.EVENT_ROW_REMOVED;
            console.warn('ag-Grid: Since version 11, event renderedRowRemoved is now called ' + RowComp.EVENT_ROW_REMOVED);
        }
        this.renderedRowEventService.removeEventListener(eventType, listener);
    }

    public getRenderedCellForColumn(column: Column): ICellComp {
        return this.renderedCells[column.getColId()];
    }

    public getCellForCol(column: Column): HTMLElement {
        let renderedCell = this.renderedCells[column.getColId()];
        if (renderedCell) {
            return renderedCell.getGui();
        } else {
            return null;
        }
    }

    public destroy(animate = false): void {
        super.destroy();

        // why do we have this method? shouldn't everything below be added as a destroy func beside
        // the corresponding create logic?

        this.destroyScope();
        this.destroyFullWidthComponent();


        if (animate) {
            this.startRemoveAnimationFunctions.forEach( func => func() );

            this.delayedDestroyFunctions.push( ()=> {
                this.forEachCellComp(renderedCell => renderedCell.destroy(false) );
            });

        } else {
            this.forEachCellComp(renderedCell => renderedCell.destroy(false) );

            // we are not animating, so execute the second stage of removal now.
            // we call getAndClear, so that they are only called once
            let delayedDestroyFunctions = this.getAndClearDelayedDestroyFunctions();
            delayedDestroyFunctions.forEach( func => func() );
        }

        let event: VirtualRowRemovedEvent = this.createRowEvent(Events.EVENT_VIRTUAL_ROW_REMOVED);

        if (this.renderedRowEventService) {
            this.renderedRowEventService.dispatchEvent(event);
        }
        this.beans.eventService.dispatchEvent(event);
    }

    private destroyScope(): void {
        if (this.scope) {
            this.scope.$destroy();
            this.scope = null;
        }
    }

    public isGroup(): boolean {
        return this.rowNode.group === true;
    }

    private refreshFullWidthComponent(): void {
        this.destroyFullWidthComponent();
        this.createFullWidthComponent();
    }

    private createFullWidthComponent(): void {

        this.fullWidthPinnedLeftLastTime = this.beans.columnController.isPinningLeft();
        this.fullWidthPinnedRightLastTime = this.beans.columnController.isPinningRight();

        if (this.eFullWidthRow) {
            let params = this.createFullWidthParams(this.eFullWidthRow, null);
            this.fullWidthRowComponent = this.beans.cellRendererService.useFullRowGroupRenderer(this.eFullWidthRow, params);
            this.angular1Compile(this.eFullWidthRow);
        }

        if (this.eFullWidthRowBody) {
            let params = this.createFullWidthParams(this.eFullWidthRowBody, null);
            this.fullWidthRowComponentBody = this.beans.cellRendererService.useFullRowGroupRenderer(this.eFullWidthRowBody, params);
            this.angular1Compile(this.eFullWidthRowBody);
        }

        if (this.eFullWidthRowLeft) {
            let params = this.createFullWidthParams(this.eFullWidthRowLeft, Column.PINNED_LEFT);
            this.fullWidthRowComponentLeft = this.beans.cellRendererService.useFullRowGroupRenderer(this.eFullWidthRowLeft, params);
            this.angular1Compile(this.eFullWidthRowLeft);
        }

        if (this.eFullWidthRowRight) {
            let params = this.createFullWidthParams(this.eFullWidthRowRight, Column.PINNED_RIGHT);
            this.fullWidthRowComponentRight = this.beans.cellRendererService.useFullRowGroupRenderer(this.eFullWidthRowRight, params);
            this.angular1Compile(this.eFullWidthRowRight);
        }

    }

    private destroyFullWidthComponent(): void {
        if (this.fullWidthRowComponent) {
            if (this.fullWidthRowComponent.destroy) {
                this.fullWidthRowComponent.destroy();
            }
            this.fullWidthRowComponent = null;
        }
        if (this.fullWidthRowComponentBody) {
            if (this.fullWidthRowComponentBody.destroy) {
                this.fullWidthRowComponentBody.destroy();
            }
            this.fullWidthRowComponent = null;
        }
        if (this.fullWidthRowComponentLeft) {
            if (this.fullWidthRowComponentLeft.destroy) {
                this.fullWidthRowComponentLeft.destroy();
            }
            this.fullWidthRowComponentLeft = null;
        }
        if (this.fullWidthRowComponentRight) {
            if (this.fullWidthRowComponentRight.destroy) {
                this.fullWidthRowComponentRight.destroy();
            }
            this.fullWidthRowComponent = null;
        }
        if (this.eFullWidthRow) {
            _.removeAllChildren(this.eFullWidthRow);
        }
        if (this.eFullWidthRowBody) {
            _.removeAllChildren(this.eFullWidthRowBody);
        }
        if (this.eFullWidthRowLeft) {
            _.removeAllChildren(this.eFullWidthRowLeft);
        }
        if (this.eFullWidthRowRight) {
            _.removeAllChildren(this.eFullWidthRowRight);
        }
    }

    private createFullWidthParams(eRow: HTMLElement, pinned: string): any {
        let params = {
            data: this.rowNode.data,
            node: this.rowNode,
            value: this.rowNode.key,
            $scope: this.scope,
            rowIndex: this.rowNode.rowIndex,
            api: this.beans.gridOptionsWrapper.getApi(),
            columnApi: this.beans.gridOptionsWrapper.getColumnApi(),
            context: this.beans.gridOptionsWrapper.getContext(),
            eGridCell: eRow,
            eParentOfValue: eRow,
            pinned: pinned,
            addRenderedRowListener: this.addEventListener.bind(this),
            colDef: {
                cellRenderer: this.fullWidthCellRenderer,
                cellRendererParams: this.fullWidthCellRendererParams
            }
        };

        if (this.fullWidthCellRendererParams) {
            _.assign(params, this.fullWidthCellRendererParams);
        }

        return params;
    }

    private createChildScopeOrNull(data: any) {
        if (this.beans.gridOptionsWrapper.isAngularCompileRows()) {
            let newChildScope = this.parentScope.$new();
            newChildScope.data = data;
            newChildScope.rowNode = this.rowNode;
            newChildScope.context = this.beans.gridOptionsWrapper.getContext();
            return newChildScope;
        } else {
            return null;
        }
    }

    private addStyleFromRowStyle(): void {
        let rowStyle = this.beans.gridOptionsWrapper.getRowStyle();
        if (rowStyle) {
            if (typeof rowStyle === 'function') {
                console.log('ag-Grid: rowStyle should be an object of key/value styles, not be a function, use getRowStyle() instead');
            } else {
                this.eAllRowContainers.forEach( row => _.addStylesToElement(row, rowStyle));
            }
        }
    }

    private addStyleFromRowStyleFunc(): void {
        let rowStyleFunc = this.beans.gridOptionsWrapper.getRowStyleFunc();
        if (rowStyleFunc) {
            let params = {
                data: this.rowNode.data,
                node: this.rowNode,
                api: this.beans.gridOptionsWrapper.getApi(),
                context: this.beans.gridOptionsWrapper.getContext(),
                $scope: this.scope
            };
            let cssToUseFromFunc = rowStyleFunc(params);
            this.eAllRowContainers.forEach( row => _.addStylesToElement(row, cssToUseFromFunc));
        }
    }

    private createEvent(event: any, eventSource: any): any {

        let agEvent = {
            node: this.rowNode,
            data: this.rowNode.data,
            rowIndex: this.rowNode.rowIndex,
            $scope: this.scope,
            context: this.beans.gridOptionsWrapper.getContext(),
            api: this.beans.gridOptionsWrapper.getApi(),
            event: <any> null,
            eventSource: <any> null
        };

        agEvent.event = event;
        agEvent.eventSource = eventSource;

        return agEvent;
    }

    private createRowContainer(rowContainerComp: RowContainerComponent, slideRowIn: boolean, eElementBefore: HTMLElement, ensureDomOrder: boolean): HTMLElement {
        let eRow = document.createElement('div');
        eRow.setAttribute('role', 'row');

        this.addDomData(eRow);

        rowContainerComp.appendRowElement(eRow, eElementBefore, ensureDomOrder);

        this.eAllRowContainers.push(eRow);

        this.delayedDestroyFunctions.push( ()=> {
            rowContainerComp.removeRowElement(eRow);
        });
        this.startRemoveAnimationFunctions.push( ()=> {
            _.addCssClass(eRow, 'ag-opacity-zero');
            if (_.exists(this.rowNode.rowTop)) {
                let rowTop = this.roundRowTopToBounds(this.rowNode.rowTop);
                this.setRowTop(rowTop);
            }
        });

        if (this.animateIn) {
            this.animateRowIn(eRow, slideRowIn);
        }

        return eRow;
    }

    // puts animation into the row by setting start state and then final state in another VM turn
    // (another VM turn so the rendering engine will kick off once with start state, and then transition
    // into the end state)
    private animateRowIn(eRow: HTMLElement, slideRowIn: boolean): void {

        if (slideRowIn) {
            // for sliding the row in, we position the row in it's old position first
            let rowTop = this.roundRowTopToBounds(this.rowNode.oldRowTop);
            this.setRowTop(rowTop);

            // and then update the position to it's new position
            this.nextVmTurnFunctions.push(this.onTopChanged.bind(this));
        } else {
            // for fading in, we first set it invisible
            _.addCssClass(eRow, 'ag-opacity-zero');
            // and then transition to visible
            this.nextVmTurnFunctions.push( () => _.removeCssClass(eRow, 'ag-opacity-zero') );
        }
    }

    // for animation, we don't want to animate entry or exit to a very far away pixel,
    // otherwise the row would move so fast, it would appear to disappear. so this method
    // moves the row closer to the viewport if it is far away, so the row slide in / out
    // at a speed the user can see.
    private roundRowTopToBounds(rowTop: number): number {
        let range = this.beans.gridPanel.getVerticalPixelRange();
        let minPixel = range.top - 100;
        let maxPixel = range.bottom + 100;
        if (rowTop < minPixel) {
            return minPixel;
        } else if (rowTop > maxPixel) {
            return maxPixel;
        } else {
            return rowTop;
        }
    }

    private createRowEventWithSource(type: string, domEvent: Event): RowEvent {
        let event = this.createRowEvent(type, domEvent);
        // when first developing this, we included the rowComp in the event.
        // this seems very weird. so when introducing the event types, i left the 'source'
        // out of the type, and just include the source in the two places where this event
        // was fired (rowClicked and rowDoubleClicked). it doesn't make sense for any
        // users to be using this, as the rowComp isn't an object we expose, so would be
        // very surprising if a user was using it.
        (<any>event).source = this;
        return event
    }

    private onRowDblClick(mouseEvent: MouseEvent): void {

        let agEvent: RowDoubleClickedEvent = this.createRowEventWithSource(Events.EVENT_ROW_DOUBLE_CLICKED, mouseEvent);

        this.beans.eventService.dispatchEvent(agEvent);
    }

    public onRowClick(mouseEvent: MouseEvent) {

        let agEvent: RowClickedEvent = this.createRowEventWithSource(Events.EVENT_ROW_CLICKED, mouseEvent);

        this.beans.eventService.dispatchEvent(agEvent);

        // ctrlKey for windows, metaKey for Apple
        let multiSelectKeyPressed = mouseEvent.ctrlKey || mouseEvent.metaKey;

        let shiftKeyPressed = mouseEvent.shiftKey;

        // we do not allow selecting groups by clicking (as the click here expands the group)
        // so return if it's a group row
        if (this.rowNode.group) {
            return;
        }

        // we also don't allow selection of pinned rows
        if (this.rowNode.rowPinned) {
            return;
        }

        // if no selection method enabled, do nothing
        if (!this.beans.gridOptionsWrapper.isRowSelection()) {
            return;
        }

        // if click selection suppressed, do nothing
        if (this.beans.gridOptionsWrapper.isSuppressRowClickSelection()) {
            return;
        }

        if (this.rowNode.isSelected()) {
            if (multiSelectKeyPressed) {
                if (this.beans.gridOptionsWrapper.isRowDeselection()) {
                    this.rowNode.setSelectedParams({newValue: false});
                }
            } else {
                // selected with no multi key, must make sure anything else is unselected
                this.rowNode.setSelectedParams({newValue: true, clearSelection: true});
            }
        } else {
            this.rowNode.setSelectedParams({newValue: true, clearSelection: !multiSelectKeyPressed, rangeSelect: shiftKeyPressed});
        }
    }

    public getRowNode(): RowNode {
        return this.rowNode;
    }

    private addClassesFromRowClassFunc(): void {

        let classes: string[] = [];

        let gridOptionsRowClassFunc = this.beans.gridOptionsWrapper.getRowClassFunc();
        if (gridOptionsRowClassFunc) {
            let params = {
                node: this.rowNode,
                data: this.rowNode.data,
                rowIndex: this.rowNode.rowIndex,
                context: this.beans.gridOptionsWrapper.getContext(),
                api: this.beans.gridOptionsWrapper.getApi()
            };
            let classToUseFromFunc = gridOptionsRowClassFunc(params);
            if (classToUseFromFunc) {
                if (typeof classToUseFromFunc === 'string') {
                    classes.push(classToUseFromFunc);
                } else if (Array.isArray(classToUseFromFunc)) {
                    classToUseFromFunc.forEach(function (classItem: any) {
                        classes.push(classItem);
                    });
                }
            }
        }

        classes.forEach( (classStr: string) => {
            this.eAllRowContainers.forEach( row => _.addCssClass(row, classStr));
        });
    }

    private addGridClasses() {
        let classes: string[] = [];

        classes.push('ag-row');
        classes.push('ag-row-no-focus');

        if (this.beans.gridOptionsWrapper.isAnimateRows()) {
            classes.push('ag-row-animation');
        } else {
            classes.push('ag-row-no-animation');
        }

        if (this.rowNode.isSelected()) {
            classes.push('ag-row-selected');
        }

        if (this.rowNode.group) {
            classes.push('ag-row-group');
            // if a group, put the level of the group in
            classes.push('ag-row-level-' + this.rowNode.level);

            if (this.rowNode.footer) {
                classes.push('ag-row-footer');
            }
        } else {
            // if a leaf, and a parent exists, put a level of the parent, else put level of 0 for top level item
            if (this.rowNode.parent) {
                classes.push('ag-row-level-' + (this.rowNode.parent.level + 1));
            } else {
                classes.push('ag-row-level-0');
            }
        }

        if (this.rowNode.stub) {
            classes.push('ag-row-stub');
        }

        if (this.fullWidthRow) {
            classes.push('ag-full-width-row');
        }

        classes.forEach( (classStr: string) => {
            this.eAllRowContainers.forEach( row => _.addCssClass(row, classStr));
        });
    }

    private addExpandedAndContractedClasses(): void {
        let isGroupNode = this.rowNode.group && !this.rowNode.footer;
        if (!isGroupNode) { return; }

        let listener = () => {
            let expanded = this.rowNode.expanded;
            this.eAllRowContainers.forEach( row => _.addOrRemoveCssClass(row, 'ag-row-group-expanded', expanded));
            this.eAllRowContainers.forEach( row => _.addOrRemoveCssClass(row, 'ag-row-group-contracted', !expanded));
        };

        this.addDestroyableEventListener(this.rowNode, RowNode.EVENT_EXPANDED_CHANGED, listener);
    }

    private addClassesFromRowClass() {
        let classes: string[] = [];

        // add in extra classes provided by the config
        let gridOptionsRowClass = this.beans.gridOptionsWrapper.getRowClass();
        if (gridOptionsRowClass) {
            if (typeof gridOptionsRowClass === 'function') {
                console.warn('ag-Grid: rowClass should not be a function, please use getRowClass instead');
            } else {
                if (typeof gridOptionsRowClass === 'string') {
                    classes.push(gridOptionsRowClass);
                } else if (Array.isArray(gridOptionsRowClass)) {
                    gridOptionsRowClass.forEach(function (classItem: any) {
                        classes.push(classItem);
                    });
                }
            }
        }

        classes.forEach( (classStr: string) => {
            this.eAllRowContainers.forEach( row => _.addCssClass(row, classStr));
        });
    }

    // returns the pinned left container, either the normal one, or the embedded full with one if exists
    public getPinnedLeftRowElement(): HTMLElement {
        return this.ePinnedLeftRow ? this.ePinnedLeftRow : this.eFullWidthRowLeft;
    }

    // returns the pinned right container, either the normal one, or the embedded full with one if exists
    public getPinnedRightRowElement(): HTMLElement {
        return this.ePinnedRightRow ? this.ePinnedRightRow : this.eFullWidthRowRight;
    }

    // returns the body container, either the normal one, or the embedded full with one if exists
    public getBodyRowElement(): HTMLElement {
        return this.eBodyRow ? this.eBodyRow : this.eFullWidthRowBody;
    }

    // returns the full width container
    public getFullWidthRowElement(): HTMLElement {
        return this.eFullWidthRow;
    }

}
