/**
 * Handle dynamic flow assignment when resources are added after load has started.
 * @param {*} QSL
 */
export default function(QSL) {
    /**
     * Handle dynamic flow assignment when resources are added after load has started.
     */
    QSL.addProcessFilters.add(function(flowId, config) {
        if (this.hasStarted && !flowId) {
            flowId = 'dynamic-' + Math.random().toString(36).slice(2);
            config.paused = true;
        }
        return [flowId, config];
    });

    /**
     * Filter out dynamic flows from initial processing.
     *
     * A run targeting one specific flow (runFlow) must pass through untouched,
     * otherwise the dynamic flow this plugin starts below would be filtered
     * out of its own run and never execute.
     */
    QSL.flowIdFilters.add(function(flowIds) {
        if (flowIds.length === 1 && flowIds[0].includes('dynamic')) return flowIds;
        return flowIds.filter(fid => !fid.includes('dynamic'));
    });

    /**
     * Process dynamic flows after all regular flows complete.
     * Checks if all non-dynamic flows are completed, then processes dynamic flows.
     */
    QSL.completedFlowsActions.add(function(flowsDone, flows, flowOptions) {
        if (!flows || !flowOptions) return flowsDone;

        /**
         * Check if all non-dynamic flows are completed
         */
        const nonDynamicFlowsDone = [...flowOptions.entries()]
            .filter(([fid]) => !fid.includes('dynamic'))
            .every(([, opt]) => opt.status === this.FLOW_STATE.COMPLETED);

        if (!nonDynamicFlowsDone) return false;

        /**
         * Process dynamic flows
         */
        const dynamicFlowIds = [...flows.keys()].filter(fid => fid.includes('dynamic'));
        if (dynamicFlowIds.length === 0) return flowsDone;

        for (const dynamicFlowId of dynamicFlowIds) {
            const dynamicOptions = flowOptions.get(dynamicFlowId);

            if (dynamicOptions && dynamicOptions.status !== this.FLOW_STATE.COMPLETED) {
                /**
                 * Hand the flow to runFlow while it is still READY — runFlow
                 * refuses any other status, and processFlows sets RUNNING
                 * itself before the flow starts.
                 */
                if (dynamicOptions.status === this.FLOW_STATE.READY) {
                    this.runFlow(dynamicFlowId);
                }
                return false;
            }
        }
        return true;
    });
}
